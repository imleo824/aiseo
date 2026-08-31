-- Supabase's live advisor confirms composite organization/site indexes do not
-- cover parent-side deletes keyed by site_id alone on these two relations.
CREATE INDEX growth_decisions_site_id_idx ON public.growth_decisions(site_id);
CREATE INDEX growth_observations_site_id_idx ON public.growth_observations(site_id);
