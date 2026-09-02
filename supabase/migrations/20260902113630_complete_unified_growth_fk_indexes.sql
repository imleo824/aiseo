-- Cover single-column foreign-key lookups used by cascades and joins. The
-- broader tenant indexes start with organization_id and cannot serve these
-- site_id-only checks efficiently.
CREATE INDEX growth_programs_site_id_idx ON public.growth_programs(site_id);
CREATE INDEX growth_decisions_site_id_idx ON public.growth_decisions(site_id);
CREATE INDEX growth_observations_site_id_idx ON public.growth_observations(site_id);
