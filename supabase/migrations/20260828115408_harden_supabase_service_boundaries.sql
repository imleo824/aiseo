-- Harden already-initialized databases. Runtime roles are deliberately
-- independent from Supabase's postgres/authenticator/service_role roles.
ALTER ROLE app_backend NOINHERIT NOBYPASSRLS;
ALTER ROLE app_worker NOINHERIT NOBYPASSRLS;
ALTER ROLE app_backend SET statement_timeout = '15s';
ALTER ROLE app_backend SET lock_timeout = '5s';
ALTER ROLE app_backend SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_worker SET statement_timeout = '120s';
ALTER ROLE app_worker SET lock_timeout = '10s';
ALTER ROLE app_worker SET idle_in_transaction_session_timeout = '60s';

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role;

-- Remove the foundation migration's broad runtime grants, then grant only the
-- operations exercised by each production process. RLS remains forced on every
-- business table as a second, independent tenant boundary.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_backend, app_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_backend, app_worker;

GRANT USAGE ON SCHEMA public, private TO app_backend, app_worker;
GRANT USAGE ON SCHEMA supabase_migrations TO app_backend, app_worker;
GRANT SELECT ON TABLE supabase_migrations.schema_migrations TO app_backend, app_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_backend, app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend, app_worker;

GRANT INSERT ON TABLE
  public.organization_members, public.sites, public.integration_connections,
  public.knowledge_sources, public.keyword_scans, public.automation_tasks,
  public.job_runs, public.draft_reviews, public.publish_attempts,
  public.payment_intents, public.ledger_entries, public.credit_holds,
  public.audit_events, public.terms_acceptances, public.idempotency_keys,
  public.payment_packages
TO app_backend;
GRANT UPDATE ON TABLE
  public.organizations, public.organization_members, public.sites,
  public.integration_connections, public.content_drafts,
  public.automation_tasks, public.payment_intents, public.payment_packages
TO app_backend;
GRANT DELETE ON TABLE public.integration_connections TO app_backend;

GRANT INSERT ON TABLE
  public.keyword_scans, public.data_snapshots, public.opportunities,
  public.job_runs, public.content_drafts, public.publish_attempts,
  public.indexing_observations, public.ledger_entries, public.credit_holds,
  public.usage_records, public.audit_events, public.notifications,
  public.worker_heartbeats
TO app_worker;
GRANT UPDATE ON TABLE
  public.organizations, public.sites, public.integration_connections,
  public.keyword_scans, public.automation_tasks, public.job_runs,
  public.content_drafts, public.publish_attempts, public.payment_intents,
  public.credit_holds, public.audit_events, public.worker_heartbeats
TO app_worker;
GRANT DELETE ON TABLE
  public.content_drafts, public.opportunities, public.keyword_scans,
  public.data_snapshots, public.knowledge_sources, public.sites,
  public.notifications, public.idempotency_keys, public.terms_acceptances
TO app_worker;

REVOKE UPDATE, DELETE ON TABLE public.ledger_entries FROM app_backend, app_worker;

CREATE OR REPLACE FUNCTION private.is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT current_user = 'app_worker'
    OR pg_has_role(session_user, 'app_worker', 'member')
$$;

DROP POLICY IF EXISTS worker_heartbeats_worker ON public.worker_heartbeats;
CREATE POLICY worker_heartbeats_worker ON public.worker_heartbeats
  USING (
    current_user = 'app_backend'
    OR pg_has_role(session_user, 'app_backend', 'member')
    OR private.is_worker()
    OR private.is_platform_admin()
  )
  WITH CHECK (private.is_worker() OR private.is_platform_admin());

-- Sensitive API operations validate the verified JWT's session_id against the
-- authoritative Auth session table. The runtime role never receives direct
-- access to auth.sessions.
CREATE OR REPLACE FUNCTION private.is_active_auth_session(candidate_session uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.sessions auth_session
    WHERE auth_session.id = candidate_session
      AND auth_session.user_id = private.current_profile_id()
  )
$$;

REVOKE ALL ON FUNCTION private.is_active_auth_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_active_auth_session(uuid) TO app_backend;

-- Email verification is checked again inside the privileged bootstrap boundary,
-- not only in Express middleware.
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
  INSERT INTO public.audit_events (organization_id, actor_id, action, target_type, target_id, metadata)
  VALUES (new_organization, current_profile, 'ORGANIZATION_BOOTSTRAPPED', 'organization', new_organization::text, '{}'::jsonb);
  RETURN new_organization;
END;
$$;

REVOKE ALL ON FUNCTION private.bootstrap_organization(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.bootstrap_organization(text) TO app_backend;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
