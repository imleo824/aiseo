-- Clean switch to the evidence-driven growth engine. Customer identity,
-- organizations, sites, integrations, payments, balances and the immutable
-- ledger are intentionally preserved; prior execution artifacts are removed.

CREATE TEMP TABLE growth_switch_guard ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM auth.users) AS auth_user_count,
  (SELECT count(*) FROM public.profiles) AS profile_count,
  (SELECT count(*) FROM public.organizations) AS organization_count,
  (SELECT count(*) FROM public.organization_members) AS organization_member_count,
  (SELECT count(*) FROM public.sites) AS site_count,
  (SELECT count(*) FROM public.integration_connections) AS integration_count,
  (SELECT count(*) FROM public.payment_intents) AS payment_count,
  (SELECT count(*) FROM public.ledger_entries) AS ledger_count,
  (SELECT coalesce(sum(credit_balance_micros), 0) FROM public.organizations) AS organization_balance_total,
  (SELECT coalesce(sum(amount_micros), 0) FROM public.ledger_entries) AS ledger_amount_total,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM auth.users row_value), '[]'::jsonb)::text) AS auth_user_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.profiles row_value), '[]'::jsonb)::text) AS profile_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.organizations row_value), '[]'::jsonb)::text) AS organization_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.organization_id, row_value.profile_id) FROM public.organization_members row_value), '[]'::jsonb)::text) AS organization_member_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.sites row_value), '[]'::jsonb)::text) AS site_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.integration_connections row_value), '[]'::jsonb)::text) AS integration_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.payment_intents row_value), '[]'::jsonb)::text) AS payment_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.created_at, row_value.id) FROM public.ledger_entries row_value), '[]'::jsonb)::text) AS ledger_hash;

DELETE FROM public.indexing_observations;
DELETE FROM public.publish_attempts;
DELETE FROM public.draft_reviews;
DELETE FROM public.growth_observations;
DELETE FROM public.growth_actions;
DELETE FROM public.growth_decisions;
DELETE FROM public.growth_run_stages;
DELETE FROM public.growth_runs;
DELETE FROM public.growth_programs;
DELETE FROM public.content_drafts;
DELETE FROM public.opportunities;
DELETE FROM public.keyword_scans;
DELETE FROM public.data_snapshots;
DELETE FROM public.knowledge_sources;
DELETE FROM public.audit_events
WHERE action ~ '^(GROWTH|DRAFT|AUTO_PUBLISH)'
   OR target_type IN (
     'growth_program',
     'growth_run',
     'growth_action',
     'content_draft',
     'execution_run',
     'growth_cycle'
   );

-- WordPress authorization and connection-verification events are security
-- records, not execution history. They deliberately survive the clean switch.

-- Credit holds are transient execution state. Usage and ledger facts remain,
-- but their optional link to deleted non-payment jobs is removed.
DELETE FROM public.credit_holds
WHERE job_run_id IN (SELECT id FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY');
UPDATE public.usage_records
SET job_run_id = NULL
WHERE job_run_id IN (SELECT id FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY');
DELETE FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY';

DROP TABLE IF EXISTS public.growth_observations;
DROP TABLE IF EXISTS private.legacy_growth_run_archive;
DROP TYPE IF EXISTS public."GrowthObservationStatus";

-- Remove retired queue values instead of keeping a permanent compatibility
-- enum. All remaining rows are PAYMENT_VERIFY after the clean switch above.
ALTER TABLE public.job_runs ALTER COLUMN type TYPE text USING type::text;
DROP TYPE public."JobType";
CREATE TYPE public."JobType" AS ENUM (
  'GROWTH_RUN',
  'GSC_SYNC',
  'GROWTH_MEASURE',
  'WORDPRESS_PUBLISH',
  'WORDPRESS_ROLLBACK',
  'PAYMENT_VERIFY',
  'AUTOMATION_RECONCILE',
  'INDEXING_MONITOR'
);
ALTER TABLE public.job_runs
  ALTER COLUMN type TYPE public."JobType" USING type::public."JobType";

-- Keep the action contract limited to mutations the production Worker can
-- actually execute, version and roll back. The removed value previously
-- implied a technical-site mutation that had no safe implementation.
ALTER TABLE public.growth_runs
  ALTER COLUMN selected_action_type TYPE text USING selected_action_type::text;
ALTER TABLE public.growth_decisions
  ALTER COLUMN selected_action_type TYPE text USING selected_action_type::text;
ALTER TABLE public.growth_actions
  ALTER COLUMN type TYPE text USING type::text;
DROP TYPE public."GrowthActionType";
CREATE TYPE public."GrowthActionType" AS ENUM (
  'UPDATE_TITLE',
  'ADD_INTERNAL_LINKS',
  'CONTENT_REFRESH',
  'ADD_CONTENT_SECTION',
  'CREATE_CONTENT',
  'DIAGNOSE_ONLY'
);
ALTER TABLE public.growth_runs
  ALTER COLUMN selected_action_type TYPE public."GrowthActionType"
  USING selected_action_type::public."GrowthActionType";
ALTER TABLE public.growth_decisions
  ALTER COLUMN selected_action_type TYPE public."GrowthActionType"
  USING selected_action_type::public."GrowthActionType";
ALTER TABLE public.growth_actions
  ALTER COLUMN type TYPE public."GrowthActionType"
  USING type::public."GrowthActionType";

CREATE TYPE public."PageVersionKind" AS ENUM ('BEFORE', 'AFTER', 'ROLLBACK');
CREATE TYPE public."MeasurementSource" AS ENUM ('GSC', 'LEADING_INDICATORS');

-- PostgreSQL treats NULL values as distinct in the original three-column
-- constraint. Platform-wide writes have no organization_id, so they need a
-- dedicated uniqueness boundary to be genuinely idempotent under concurrency.
CREATE UNIQUE INDEX idempotency_keys_global_profile_key_key
  ON public.idempotency_keys(profile_id, key)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX growth_programs_one_active_continuous_per_site
  ON public.growth_programs(site_id)
  WHERE mode = 'CONTINUOUS' AND status = 'ACTIVE';

CREATE TABLE public.site_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.growth_runs(id) ON DELETE CASCADE,
  status public."DataStatus" NOT NULL DEFAULT 'LIVE',
  source_version text NOT NULL,
  market jsonb NOT NULL,
  health jsonb NOT NULL,
  corpus_checksum text NOT NULL,
  page_count integer NOT NULL,
  audited_page_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_snapshots_run_key UNIQUE (run_id),
  CONSTRAINT site_snapshots_counts_valid CHECK (
    page_count >= 0 AND audited_page_count >= 0 AND audited_page_count <= page_count
  ),
  CONSTRAINT site_snapshots_checksum_valid CHECK (corpus_checksum ~ '^[a-f0-9]{64}$')
);
CREATE INDEX site_snapshots_org_site_fetched_idx
  ON public.site_snapshots(organization_id, site_id, fetched_at DESC);

CREATE TABLE public.site_page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.site_snapshots(id) ON DELETE CASCADE,
  wordpress_id text,
  resource_type text NOT NULL,
  url text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL,
  modified_at timestamptz,
  title text NOT NULL,
  excerpt text,
  content text NOT NULL,
  content_checksum text NOT NULL,
  word_count integer NOT NULL,
  internal_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  technical_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_page_snapshots_snapshot_url_key UNIQUE (snapshot_id, url),
  CONSTRAINT site_page_snapshots_word_count_valid CHECK (word_count >= 0),
  CONSTRAINT site_page_snapshots_checksum_valid CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT site_page_snapshots_url_https CHECK (url ~ '^https://')
);
CREATE INDEX site_page_snapshots_org_site_created_idx
  ON public.site_page_snapshots(organization_id, site_id, created_at DESC);
CREATE INDEX site_page_snapshots_site_checksum_idx
  ON public.site_page_snapshots(site_id, content_checksum);

ALTER TABLE public.opportunities
  ADD COLUMN site_snapshot_id uuid REFERENCES public.site_snapshots(id) ON DELETE SET NULL;
CREATE INDEX opportunities_site_snapshot_idx ON public.opportunities(site_snapshot_id);

CREATE TABLE public.action_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.growth_actions(id) ON DELETE CASCADE,
  type text NOT NULL,
  source_ref text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_evidence_type_required CHECK (length(trim(type)) BETWEEN 1 AND 80)
);
CREATE INDEX action_evidence_org_action_created_idx
  ON public.action_evidence(organization_id, action_id, created_at);
CREATE INDEX action_evidence_site_type_idx ON public.action_evidence(site_id, type);

CREATE TABLE public.page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.growth_actions(id) ON DELETE CASCADE,
  kind public."PageVersionKind" NOT NULL,
  remote_post_id text NOT NULL,
  resource_type text NOT NULL,
  url text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  content_checksum text NOT NULL,
  remote_modified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_versions_action_kind_key UNIQUE (action_id, kind),
  CONSTRAINT page_versions_checksum_valid CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT page_versions_url_https CHECK (url ~ '^https://')
);
CREATE INDEX page_versions_org_site_created_idx
  ON public.page_versions(organization_id, site_id, created_at DESC);

CREATE TABLE public.measurement_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.growth_actions(id) ON DELETE CASCADE,
  source public."MeasurementSource" NOT NULL,
  window_days integer NOT NULL,
  source_snapshot_id uuid REFERENCES public.data_snapshots(id) ON DELETE SET NULL,
  baseline jsonb NOT NULL,
  measurement jsonb NOT NULL,
  observed_click_delta_micros bigint,
  confidence_micros bigint NOT NULL DEFAULT 0,
  outcome public."GrowthOutcome" NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT measurement_samples_action_source_window_key UNIQUE (action_id, source, window_days),
  CONSTRAINT measurement_samples_window_valid CHECK (
    (source = 'GSC' AND window_days IN (14, 28, 56))
    OR (source = 'LEADING_INDICATORS' AND window_days = 7)
  ),
  CONSTRAINT measurement_samples_confidence_valid CHECK (confidence_micros BETWEEN 0 AND 1000000)
);
CREATE INDEX measurement_samples_org_site_observed_idx
  ON public.measurement_samples(organization_id, site_id, observed_at DESC);
CREATE INDEX measurement_samples_source_snapshot_idx
  ON public.measurement_samples(source_snapshot_id);

CREATE TABLE public.site_mutation_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES public.growth_runs(id) ON DELETE CASCADE,
  action_id uuid UNIQUE REFERENCES public.growth_actions(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL UNIQUE,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT site_mutation_leases_expiry_valid CHECK (expires_at > acquired_at)
);
CREATE INDEX site_mutation_leases_expires_idx ON public.site_mutation_leases(expires_at);

CREATE TABLE public.policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  version text NOT NULL,
  config jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_versions_kind_version_key UNIQUE (kind, version),
  CONSTRAINT policy_versions_required CHECK (
    length(trim(kind)) BETWEEN 1 AND 80 AND length(trim(version)) BETWEEN 1 AND 80
  )
);
CREATE INDEX policy_versions_kind_active_idx ON public.policy_versions(kind, active);

INSERT INTO public.policy_versions (kind, version, config)
VALUES
  ('OPPORTUNITY_SCORE', 'opportunity-score-4', '{"minimumConfidenceMicros":550000,"formula":"impact*relevance*intent*siteFit*confidence*clickOpportunity/(cost+risk)"}'::jsonb),
  ('ACTION_POLICY', 'action-policy-4', '{"safeRiskLevels":["A","B"],"observationWindowsDays":[14,28,56],"oneMutationPerSite":true}'::jsonb),
  ('QUALITY_GATE', 'quality-gate-3', '{"requiresSourceTraceability":true,"requiresIntentCoverage":true,"maximumSourceOverlap":0.15,"fixedWordCountRankingRule":false}'::jsonb);

CREATE OR REPLACE FUNCTION private.enforce_growth_evidence_tenant_integrity()
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
    RAISE EXCEPTION 'evidence site does not belong to organization' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'site_snapshots' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id AND run.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'site snapshot run tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'site_page_snapshots' THEN
    IF NOT EXISTS (SELECT 1 FROM public.site_snapshots snapshot WHERE snapshot.id = NEW.snapshot_id AND snapshot.organization_id = NEW.organization_id AND snapshot.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'site page snapshot tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME IN ('action_evidence', 'page_versions', 'measurement_samples') THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_actions action WHERE action.id = NEW.action_id AND action.organization_id = NEW.organization_id AND action.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'action evidence tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'measurement_samples' AND NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.data_snapshots snapshot
      WHERE snapshot.id = NEW.source_snapshot_id AND snapshot.organization_id = NEW.organization_id AND snapshot.site_id = NEW.site_id
    ) THEN
      RAISE EXCEPTION 'measurement snapshot tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'site_mutation_leases' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id AND run.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'site lease run tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NEW.action_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.growth_actions action
      WHERE action.id = NEW.action_id AND action.run_id = NEW.run_id AND action.organization_id = NEW.organization_id AND action.site_id = NEW.site_id
    ) THEN
      RAISE EXCEPTION 'site lease action tenant does not match' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_growth_evidence_tenant_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_growth_evidence_tenant_integrity()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE CONSTRAINT TRIGGER site_snapshots_tenant_integrity
  AFTER INSERT OR UPDATE ON public.site_snapshots DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();
CREATE CONSTRAINT TRIGGER site_page_snapshots_tenant_integrity
  AFTER INSERT OR UPDATE ON public.site_page_snapshots DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();
CREATE CONSTRAINT TRIGGER action_evidence_tenant_integrity
  AFTER INSERT OR UPDATE ON public.action_evidence DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();
CREATE CONSTRAINT TRIGGER page_versions_tenant_integrity
  AFTER INSERT OR UPDATE ON public.page_versions DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();
CREATE CONSTRAINT TRIGGER measurement_samples_tenant_integrity
  AFTER INSERT OR UPDATE ON public.measurement_samples DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();
CREATE CONSTRAINT TRIGGER site_mutation_leases_tenant_integrity
  AFTER INSERT OR UPDATE ON public.site_mutation_leases DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_evidence_tenant_integrity();

CREATE OR REPLACE FUNCTION private.reject_growth_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- The isolated account-erasure RPC runs as postgres on behalf of the
  -- service-role JWT and must be able to cascade-delete customer content.
  -- Runtime application roles still cannot mutate or delete evidence rows.
  IF TG_OP = 'DELETE'
    AND current_user = 'postgres'
    AND coalesce(auth.role(), '') = 'service_role'
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION private.reject_growth_evidence_mutation()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE TRIGGER site_snapshots_immutable BEFORE UPDATE OR DELETE ON public.site_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();
CREATE TRIGGER site_page_snapshots_immutable BEFORE UPDATE OR DELETE ON public.site_page_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();
CREATE TRIGGER action_evidence_immutable BEFORE UPDATE OR DELETE ON public.action_evidence
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();
CREATE TRIGGER page_versions_immutable BEFORE UPDATE OR DELETE ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();
CREATE TRIGGER measurement_samples_immutable BEFORE UPDATE OR DELETE ON public.measurement_samples
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();
CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON public.policy_versions
  FOR EACH ROW EXECUTE FUNCTION private.reject_growth_evidence_mutation();

ALTER TABLE public.site_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_page_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.action_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.page_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_samples FORCE ROW LEVEL SECURITY;
ALTER TABLE public.site_mutation_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_mutation_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_select ON public.site_snapshots FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.site_snapshots FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_select ON public.site_page_snapshots FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.site_page_snapshots FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_select ON public.action_evidence FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.action_evidence FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_select ON public.page_versions FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.page_versions FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_select ON public.measurement_samples FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.measurement_samples FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_select ON public.site_mutation_leases FOR SELECT
  USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.site_mutation_leases FOR INSERT
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.site_mutation_leases FOR UPDATE
  USING (private.can_mutate_organization(organization_id, 'EDITOR'))
  WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.site_mutation_leases FOR DELETE
  USING (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY runtime_select ON public.policy_versions FOR SELECT USING (true);

REVOKE ALL ON TABLE public.site_snapshots, public.site_page_snapshots,
  public.action_evidence, public.page_versions, public.measurement_samples,
  public.site_mutation_leases, public.policy_versions
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.site_snapshots, public.site_page_snapshots,
  public.action_evidence, public.page_versions, public.measurement_samples,
  public.policy_versions TO app_backend;
GRANT SELECT, INSERT ON TABLE public.site_snapshots, public.site_page_snapshots,
  public.action_evidence, public.page_versions, public.measurement_samples TO app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_mutation_leases TO app_worker;
GRANT SELECT ON TABLE public.policy_versions TO app_worker;

COMMENT ON TABLE public.site_snapshots IS 'Immutable site-level evidence captured for one growth run.';
COMMENT ON TABLE public.site_page_snapshots IS 'Immutable WordPress page inventory and technical evidence for a site snapshot.';
COMMENT ON TABLE public.action_evidence IS 'Append-only evidence explaining why a growth action was selected.';
COMMENT ON TABLE public.page_versions IS 'Append-only before, after and rollback versions of WordPress mutations.';
COMMENT ON TABLE public.measurement_samples IS 'Immutable 14/28/56-day GSC or seven-day leading-indicator samples.';
COMMENT ON TABLE public.site_mutation_leases IS 'Database-enforced single mutation lease per site.';

DO $$
DECLARE
  guard growth_switch_guard%ROWTYPE;
BEGIN
  SELECT * INTO guard FROM growth_switch_guard;
  IF guard.auth_user_count <> (SELECT count(*) FROM auth.users)
    OR guard.profile_count <> (SELECT count(*) FROM public.profiles)
    OR guard.organization_count <> (SELECT count(*) FROM public.organizations)
    OR guard.organization_member_count <> (SELECT count(*) FROM public.organization_members)
    OR guard.site_count <> (SELECT count(*) FROM public.sites)
    OR guard.integration_count <> (SELECT count(*) FROM public.integration_connections)
    OR guard.payment_count <> (SELECT count(*) FROM public.payment_intents)
    OR guard.ledger_count <> (SELECT count(*) FROM public.ledger_entries)
    OR guard.organization_balance_total <> (SELECT coalesce(sum(credit_balance_micros), 0) FROM public.organizations)
    OR guard.ledger_amount_total <> (SELECT coalesce(sum(amount_micros), 0) FROM public.ledger_entries)
    OR guard.auth_user_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM auth.users row_value), '[]'::jsonb)::text)
    OR guard.profile_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.profiles row_value), '[]'::jsonb)::text)
    OR guard.organization_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.organizations row_value), '[]'::jsonb)::text)
    OR guard.organization_member_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.organization_id, row_value.profile_id) FROM public.organization_members row_value), '[]'::jsonb)::text)
    OR guard.site_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.sites row_value), '[]'::jsonb)::text)
    OR guard.integration_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.integration_connections row_value), '[]'::jsonb)::text)
    OR guard.payment_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.payment_intents row_value), '[]'::jsonb)::text)
    OR guard.ledger_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.created_at, row_value.id) FROM public.ledger_entries row_value), '[]'::jsonb)::text)
  THEN
    RAISE EXCEPTION 'growth engine switch attempted to change protected account, payment or ledger facts';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY') THEN
    RAISE EXCEPTION 'retired job types remain after growth engine switch';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organizations organization
    LEFT JOIN LATERAL (
      SELECT balance_after_micros
      FROM public.ledger_entries entry
      WHERE entry.organization_id = organization.id
      ORDER BY entry.created_at DESC, entry.id DESC
      LIMIT 1
    ) latest ON true
    WHERE organization.credit_balance_micros <> coalesce(latest.balance_after_micros, 0)
  ) THEN
    RAISE EXCEPTION 'ledger reconciliation failed after growth engine switch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.growth_programs)
    OR EXISTS (SELECT 1 FROM public.growth_runs)
    OR EXISTS (SELECT 1 FROM public.content_drafts)
    OR EXISTS (SELECT 1 FROM public.opportunities)
  THEN
    RAISE EXCEPTION 'legacy execution history was not completely removed';
  END IF;
END;
$$;
