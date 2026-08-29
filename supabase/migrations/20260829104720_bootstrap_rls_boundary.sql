-- These tables remain protected by RLS for every runtime role.  FORCE RLS,
-- however, also blocks the tightly scoped SECURITY DEFINER bootstrap function
-- from inserting an organization before its first membership exists.  The
-- function is owned by the database owner; app_backend/app_worker neither own
-- tables nor have BYPASSRLS, so removing FORCE here does not broaden runtime
-- access.
ALTER TABLE public.organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events NO FORCE ROW LEVEL SECURITY;

-- Make the migration safe when applied after an interrupted prior migration.
ALTER TABLE public.audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION private.bootstrap_organization(organization_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_profile uuid := private.current_profile_id();
  new_organization uuid;
BEGIN
  IF current_profile IS NULL OR length(trim(organization_name)) < 2 THEN
    RAISE EXCEPTION 'verified profile and organization name are required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users auth_user
    WHERE auth_user.id = current_profile AND auth_user.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'verified email is required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE profile_id = current_profile) THEN
    RAISE EXCEPTION 'profile already belongs to an organization' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organizations (id, name, credit_balance_micros, created_at, updated_at)
  VALUES (gen_random_uuid(), trim(organization_name), 0, now(), now())
  RETURNING id INTO new_organization;
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (new_organization, current_profile, 'OWNER');
  INSERT INTO public.audit_events (id, organization_id, actor_id, action, target_type, target_id, metadata)
  VALUES (gen_random_uuid(), new_organization, current_profile, 'ORGANIZATION_BOOTSTRAPPED', 'organization', new_organization::text, '{}'::jsonb);
  RETURN new_organization;
END;
$$;

ALTER FUNCTION private.bootstrap_organization(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.bootstrap_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.bootstrap_organization(text) TO app_backend;
