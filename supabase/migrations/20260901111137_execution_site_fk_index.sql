CREATE INDEX execution_runs_site_id_idx ON public.execution_runs(site_id);

COMMENT ON INDEX public.execution_runs_site_id_idx IS 'Covers the site foreign key for joins and safe parent-row deletion checks.';
