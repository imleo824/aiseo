-- Worker authority is tied to the active database role, never inherited from
-- the session login role. This prevents an administrative/test login that may
-- assume app_worker from silently bypassing organization policies as app_backend.
CREATE OR REPLACE FUNCTION private.is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$ SELECT current_user = 'app_worker' $$;

ALTER FUNCTION private.is_worker() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.is_worker() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_worker() TO app_backend, app_worker;
