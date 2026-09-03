-- Qualify every column that can collide with the RETURNS TABLE output variable.
-- This keeps the delayed-erasure RPC lint-clean and prevents runtime ambiguity.
CREATE OR REPLACE FUNCTION public.claim_due_account_erasures(max_count integer DEFAULT 50)
RETURNS TABLE(profile_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  owned_organizations uuid[];
  pseudonym text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF max_count < 1 OR max_count > 100 THEN
    RAISE EXCEPTION 'max_count must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT profile.id
    FROM public.profiles AS profile
    WHERE profile.deletion_requested_at <= now() - interval '30 days'
      AND (profile.erasure_claimed_at IS NULL OR profile.erasure_claimed_at < now() - interval '10 minutes')
    ORDER BY profile.deletion_requested_at, profile.id
    FOR UPDATE SKIP LOCKED
    LIMIT max_count
  LOOP
    UPDATE public.profiles AS profile
    SET erasure_claimed_at = now(), updated_at = now()
    WHERE profile.id = candidate.id;

    SELECT coalesce(array_agg(membership.organization_id), ARRAY[]::uuid[])
    INTO owned_organizations
    FROM public.organization_members AS membership
    WHERE membership.profile_id = candidate.id
      AND membership.role = 'OWNER'
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members AS other_owner
        WHERE other_owner.organization_id = membership.organization_id
          AND other_owner.profile_id <> candidate.id
          AND other_owner.role = 'OWNER'
      );

    pseudonym := substring(md5(candidate.id::text) FROM 1 FOR 16);
    DELETE FROM public.sites AS site
    WHERE site.organization_id = ANY(owned_organizations);
    DELETE FROM public.knowledge_sources AS knowledge_source
    WHERE knowledge_source.organization_id = ANY(owned_organizations);
    DELETE FROM public.notifications AS notification
    WHERE notification.profile_id = candidate.id;
    DELETE FROM public.idempotency_keys AS idempotency_key
    WHERE idempotency_key.profile_id = candidate.id;
    DELETE FROM public.terms_acceptances AS terms_acceptance
    WHERE terms_acceptance.profile_id = candidate.id;
    UPDATE public.job_runs AS job_run
    SET payload = '{"redacted":true}'::jsonb, result = NULL, error_code = NULL, error_message = NULL
    WHERE job_run.organization_id = ANY(owned_organizations);
    UPDATE public.audit_events AS audit_event
    SET actor_id = NULL, metadata = '{"redacted":true}'::jsonb
    WHERE audit_event.actor_id = candidate.id
       OR audit_event.organization_id = ANY(owned_organizations);
    UPDATE public.organizations AS organization
    SET name = 'Deleted organization ' || pseudonym,
        disabled_at = coalesce(organization.disabled_at, now()),
        updated_at = now()
    WHERE organization.id = ANY(owned_organizations);
    INSERT INTO public.audit_events (action, target_type, target_id, metadata)
    VALUES (
      'ACCOUNT_DATA_ERASED', 'profile_hash', pseudonym,
      jsonb_build_object('retained', jsonb_build_array('ledger', 'payment_intent', 'audit_event'))
    );

    profile_id := candidate.id;
    RETURN NEXT;
  END LOOP;
END;
$$;

ALTER FUNCTION public.claim_due_account_erasures(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_due_account_erasures(integer)
FROM PUBLIC, anon, authenticated, app_backend, app_worker;
GRANT EXECUTE ON FUNCTION public.claim_due_account_erasures(integer) TO service_role;
