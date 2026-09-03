-- Allow the database administrator used by local Supabase and pgTAP to assume
-- the same least-privilege runtime roles exercised in production. Membership is
-- intentionally one-way: neither application role can assume postgres.
grant app_backend to postgres;
grant app_worker to postgres;
