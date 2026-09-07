-- Cover foreign keys that are not the leading column of an existing index.
-- These indexes keep parent updates/deletes and direct relation lookups bounded
-- as execution evidence grows across many customer sites.

CREATE INDEX site_snapshots_site_id_idx
  ON public.site_snapshots(site_id);

CREATE INDEX action_evidence_action_id_idx
  ON public.action_evidence(action_id);

CREATE INDEX page_versions_site_id_idx
  ON public.page_versions(site_id);

CREATE INDEX measurement_samples_site_id_idx
  ON public.measurement_samples(site_id);

CREATE INDEX site_mutation_leases_organization_id_idx
  ON public.site_mutation_leases(organization_id);
