-- The Web API exposes owner-only deletion for an empty, unbound site. Keep the
-- database role least-privileged while allowing that exact table operation;
-- the existing forced-RLS organization_delete policy remains the independent
-- tenant/role boundary and requires at least ADMIN inside the database.
GRANT DELETE ON TABLE public.sites TO app_backend;
