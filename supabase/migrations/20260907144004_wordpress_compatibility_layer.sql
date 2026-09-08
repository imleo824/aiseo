-- Immutable WordPress capability profiles make plugin/editor compatibility an
-- explicit write gate. Existing sites must be rechecked before new mutations.

CREATE TYPE public."WordPressCompatibilityMode" AS ENUM (
  'RECHECK_REQUIRED', 'FULL_AUTO', 'SAFE_AUTO', 'ANALYSIS_ONLY', 'BLOCKED'
);
CREATE TYPE public."WordPressEditorKind" AS ENUM (
  'CLASSIC', 'GUTENBERG', 'ELEMENTOR', 'DIVI', 'HEADLESS', 'UNKNOWN'
);
CREATE TYPE public."WordPressRemoteMutationState" AS ENUM (
  'PREPARED', 'COMMITTED', 'VERIFIED', 'VISIBILITY_PENDING',
  'CONFLICTED', 'FAILED', 'ROLLED_BACK'
);

ALTER TABLE public.sites
  ADD COLUMN wordpress_compatibility_mode public."WordPressCompatibilityMode" NOT NULL DEFAULT 'RECHECK_REQUIRED',
  ADD COLUMN wordpress_compatibility_checked_at timestamptz,
  ADD COLUMN latest_wordpress_compatibility_profile_id uuid;

CREATE TABLE public.wordpress_compatibility_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  rest_fingerprint text NOT NULL,
  core_version_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  authentication_mode text NOT NULL,
  route_schemas jsonb NOT NULL,
  content_types jsonb NOT NULL,
  editor_signals jsonb NOT NULL,
  integration_signals jsonb NOT NULL,
  action_capabilities jsonb NOT NULL,
  mode public."WordPressCompatibilityMode" NOT NULL,
  block_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT wordpress_compatibility_profiles_fingerprint_valid
    CHECK (rest_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT wordpress_compatibility_profiles_expiry_valid
    CHECK (expires_at > checked_at),
  CONSTRAINT wordpress_compatibility_profiles_policy_required
    CHECK (length(trim(policy_version)) BETWEEN 1 AND 80),
  CONSTRAINT wordpress_compatibility_profiles_reasons_array
    CHECK (jsonb_typeof(block_reasons) = 'array'),
  CONSTRAINT wordpress_compatibility_profiles_capabilities_object
    CHECK (jsonb_typeof(action_capabilities) = 'object')
);
CREATE INDEX wordpress_compatibility_profiles_org_site_checked_idx
  ON public.wordpress_compatibility_profiles(organization_id, site_id, checked_at DESC);
CREATE INDEX wordpress_compatibility_profiles_site_expiry_idx
  ON public.wordpress_compatibility_profiles(site_id, expires_at);

ALTER TABLE public.sites
  ADD CONSTRAINT sites_latest_wordpress_compatibility_profile_key
    UNIQUE (latest_wordpress_compatibility_profile_id),
  ADD CONSTRAINT sites_latest_wordpress_compatibility_profile_fkey
    FOREIGN KEY (latest_wordpress_compatibility_profile_id)
    REFERENCES public.wordpress_compatibility_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.growth_actions
  ADD COLUMN wordpress_compatibility_profile_id uuid
    REFERENCES public.wordpress_compatibility_profiles(id) ON DELETE SET NULL,
  ADD COLUMN remote_mutation_state public."WordPressRemoteMutationState",
  ADD COLUMN fallback_reason text;
CREATE INDEX growth_actions_wordpress_compatibility_idx
  ON public.growth_actions(wordpress_compatibility_profile_id);

ALTER TABLE public.site_page_snapshots
  ADD COLUMN editor_kind public."WordPressEditorKind" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN structure_checksum text,
  ADD COLUMN action_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE public.site_page_snapshots
SET structure_checksum = content_checksum
WHERE structure_checksum IS NULL;
ALTER TABLE public.site_page_snapshots
  ALTER COLUMN structure_checksum SET NOT NULL,
  ADD CONSTRAINT site_page_snapshots_structure_checksum_valid
    CHECK (structure_checksum ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT site_page_snapshots_action_capabilities_object
    CHECK (jsonb_typeof(action_capabilities) = 'object');

ALTER TABLE public.page_versions
  ADD COLUMN payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN structure_checksum text,
  ADD COLUMN rest_schema_fingerprint text,
  ADD COLUMN remote_revision_id text,
  ADD COLUMN public_verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT page_versions_changed_fields_array
    CHECK (jsonb_typeof(changed_fields) = 'array'),
  ADD CONSTRAINT page_versions_structure_checksum_valid
    CHECK (structure_checksum IS NULL OR structure_checksum ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT page_versions_rest_schema_fingerprint_valid
    CHECK (rest_schema_fingerprint IS NULL OR rest_schema_fingerprint ~ '^[a-f0-9]{64}$');

CREATE OR REPLACE FUNCTION private.enforce_wordpress_compatibility_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sites site
    WHERE site.id = NEW.site_id AND site.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'compatibility profile site does not belong to organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_wordpress_compatibility_tenant_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_wordpress_compatibility_tenant_integrity()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE CONSTRAINT TRIGGER wordpress_compatibility_profiles_tenant_integrity
  AFTER INSERT OR UPDATE ON public.wordpress_compatibility_profiles
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_wordpress_compatibility_tenant_integrity();

CREATE OR REPLACE FUNCTION private.enforce_wordpress_compatibility_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  referenced_profile_id uuid;
  referenced_site_id uuid;
BEGIN
  referenced_profile_id := CASE
    WHEN TG_TABLE_NAME = 'sites' THEN NEW.latest_wordpress_compatibility_profile_id
    ELSE NEW.wordpress_compatibility_profile_id
  END;
  referenced_site_id := CASE WHEN TG_TABLE_NAME = 'sites' THEN NEW.id ELSE NEW.site_id END;
  IF referenced_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.wordpress_compatibility_profiles profile
    WHERE profile.id = referenced_profile_id
      AND profile.site_id = referenced_site_id
      AND profile.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'WordPress compatibility profile tenant or site does not match'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_wordpress_compatibility_reference_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_wordpress_compatibility_reference_integrity()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE CONSTRAINT TRIGGER sites_wordpress_compatibility_reference_integrity
  AFTER INSERT OR UPDATE OF latest_wordpress_compatibility_profile_id ON public.sites
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_wordpress_compatibility_reference_integrity();
CREATE CONSTRAINT TRIGGER growth_actions_wordpress_compatibility_reference_integrity
  AFTER INSERT OR UPDATE OF wordpress_compatibility_profile_id ON public.growth_actions
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_wordpress_compatibility_reference_integrity();

CREATE TRIGGER wordpress_compatibility_profiles_immutable
  BEFORE UPDATE OR DELETE ON public.wordpress_compatibility_profiles
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();

ALTER TABLE public.wordpress_compatibility_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wordpress_compatibility_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_select ON public.wordpress_compatibility_profiles FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.wordpress_compatibility_profiles FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));

REVOKE ALL ON TABLE public.wordpress_compatibility_profiles
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.wordpress_compatibility_profiles TO app_backend;
GRANT SELECT, INSERT ON TABLE public.wordpress_compatibility_profiles TO app_worker;

INSERT INTO public.policy_versions (kind, version, config)
VALUES (
  'WORDPRESS_COMPATIBILITY',
  'wordpress-compatibility-1',
  '{"profileTtlHours":24,"unknownImplementations":"fail_closed","pluginManagement":false,"privateMetaWrites":false}'::jsonb
);

COMMENT ON TABLE public.wordpress_compatibility_profiles IS
  'Append-only evidence of the WordPress REST, editor and integration capabilities used to authorize a mutation.';
COMMENT ON COLUMN public.sites.wordpress_compatibility_mode IS
  'Latest compatibility decision. RECHECK_REQUIRED blocks new WordPress mutations until a scan succeeds.';
COMMENT ON COLUMN public.growth_actions.remote_mutation_state IS
  'Remote WordPress write lifecycle, separate from the business action status.';
