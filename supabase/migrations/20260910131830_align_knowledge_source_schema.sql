-- Keep the indexed access path aligned with the role-aware evidence queries.
-- The former index is superseded because role is now part of source identity.

DROP INDEX IF EXISTS public.knowledge_sources_organization_id_site_id_status_created_at_idx;

CREATE INDEX knowledge_sources_org_site_role_status_idx
  ON public.knowledge_sources(organization_id, site_id, role, status, created_at DESC);
