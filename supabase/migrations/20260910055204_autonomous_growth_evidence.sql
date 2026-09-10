-- Clean production switch for the autonomous evidence model. Account, site,
-- integration, payment, balance and immutable-ledger data are guarded and
-- preserved; all previous execution artifacts are intentionally removed.

CREATE TEMP TABLE autonomous_growth_guard ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM auth.users) AS auth_user_count,
  (SELECT count(*) FROM public.profiles) AS profile_count,
  (SELECT count(*) FROM public.organizations) AS organization_count,
  (SELECT count(*) FROM public.organization_members) AS member_count,
  (SELECT count(*) FROM public.sites) AS site_count,
  (SELECT count(*) FROM public.integration_connections) AS integration_count,
  (SELECT count(*) FROM public.payment_intents) AS payment_count,
  (SELECT count(*) FROM public.ledger_entries) AS ledger_count,
  (SELECT coalesce(sum(credit_balance_micros), 0) FROM public.organizations) AS balance_total,
  (SELECT coalesce(sum(amount_micros), 0) FROM public.ledger_entries) AS ledger_total,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM auth.users row_value), '[]'::jsonb)::text) AS auth_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.profiles row_value), '[]'::jsonb)::text) AS profile_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.organizations row_value), '[]'::jsonb)::text) AS organization_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.organization_id, row_value.profile_id) FROM public.organization_members row_value), '[]'::jsonb)::text) AS member_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.sites row_value), '[]'::jsonb)::text) AS site_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.integration_connections row_value), '[]'::jsonb)::text) AS integration_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.payment_intents row_value), '[]'::jsonb)::text) AS payment_hash,
  md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.created_at, row_value.id) FROM public.ledger_entries row_value), '[]'::jsonb)::text) AS ledger_hash;

DELETE FROM public.indexing_observations;
DELETE FROM public.publish_attempts;
DELETE FROM public.draft_reviews;
DELETE FROM public.measurement_samples;
DELETE FROM public.page_versions;
DELETE FROM public.action_evidence;
DELETE FROM public.site_mutation_leases;
DELETE FROM public.growth_actions;
DELETE FROM public.growth_decisions;
DELETE FROM public.growth_run_stages;
DELETE FROM public.growth_runs;
DELETE FROM public.growth_program_inputs;
DELETE FROM public.growth_programs;
DELETE FROM public.content_drafts;
DELETE FROM public.opportunities;
DELETE FROM public.keyword_scans;
DELETE FROM public.site_page_snapshots;
DELETE FROM public.site_snapshots;
DELETE FROM public.data_snapshots;
DELETE FROM public.knowledge_sources;

DELETE FROM public.credit_holds
WHERE job_run_id IN (SELECT id FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY');
UPDATE public.usage_records
SET job_run_id = NULL
WHERE job_run_id IN (SELECT id FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY');
DELETE FROM public.job_runs WHERE type <> 'PAYMENT_VERIFY';
DELETE FROM public.audit_events
WHERE action ~ '^(GROWTH|DRAFT|AUTO_PUBLISH)'
   OR target_type IN ('growth_program', 'growth_run', 'growth_action', 'content_draft');

-- An attached signal is optional. With no input, the Worker derives the seed
-- only from the immutable WordPress site snapshot.
DROP TRIGGER IF EXISTS growth_programs_require_inputs ON public.growth_programs;
DROP FUNCTION IF EXISTS private.enforce_growth_program_has_inputs();

ALTER TABLE public.growth_programs
  ADD COLUMN last_evidence_fingerprint text,
  ADD COLUMN last_evidence_at timestamptz,
  ADD CONSTRAINT growth_programs_evidence_fingerprint_valid CHECK (
    last_evidence_fingerprint IS NULL
    OR last_evidence_fingerprint ~ '^[a-f0-9]{64}$'
  );

-- A stored byte payload and its semantic role are different identities. The
-- same bytes may legitimately be both target-site evidence and an external
-- reference, so content is deduplicated without collapsing source provenance.
CREATE TYPE public."KnowledgeSourceRole" AS ENUM (
  'TARGET_SITE',
  'REFERENCE',
  'COMPETITOR'
);

CREATE TABLE public.knowledge_content_blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  checksum text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_content_blobs_org_checksum_key UNIQUE (organization_id, checksum),
  CONSTRAINT knowledge_content_blobs_checksum_valid CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT knowledge_content_blobs_content_required CHECK (length(content) > 0)
);
CREATE INDEX knowledge_content_blobs_org_created_idx
  ON public.knowledge_content_blobs(organization_id, created_at DESC);

DROP INDEX IF EXISTS public.knowledge_sources_organization_id_checksum_key;
ALTER TABLE public.knowledge_sources
  ADD COLUMN content_blob_id uuid NOT NULL,
  ADD COLUMN role public."KnowledgeSourceRole" NOT NULL,
  ADD COLUMN identity_fingerprint text NOT NULL,
  ALTER COLUMN site_id SET NOT NULL,
  ALTER COLUMN source_url SET NOT NULL,
  ALTER COLUMN normalized_url SET NOT NULL,
  DROP COLUMN type,
  DROP COLUMN content,
  DROP COLUMN checksum,
  ADD CONSTRAINT knowledge_sources_content_blob_fkey
    FOREIGN KEY (content_blob_id) REFERENCES public.knowledge_content_blobs(id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT knowledge_sources_org_identity_key
    UNIQUE (organization_id, identity_fingerprint),
  ADD CONSTRAINT knowledge_sources_identity_valid
    CHECK (identity_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT knowledge_sources_urls_https
    CHECK (source_url ~ '^https://' AND normalized_url ~ '^https://');
DROP TYPE public."KnowledgeSourceType";
CREATE INDEX knowledge_sources_content_blob_id_idx
  ON public.knowledge_sources(content_blob_id);

CREATE OR REPLACE FUNCTION private.enforce_knowledge_source_integrity()
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
    RAISE EXCEPTION 'knowledge source site does not belong to organization'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.knowledge_content_blobs blob
    WHERE blob.id = NEW.content_blob_id AND blob.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'knowledge source content blob does not belong to organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_knowledge_source_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_knowledge_source_integrity()
  FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;
CREATE CONSTRAINT TRIGGER knowledge_sources_tenant_integrity
  AFTER INSERT OR UPDATE ON public.knowledge_sources
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION private.enforce_knowledge_source_integrity();

ALTER TABLE public.knowledge_content_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_content_blobs FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_select ON public.knowledge_content_blobs
  FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.knowledge_content_blobs
  FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));

REVOKE ALL ON TABLE public.knowledge_content_blobs, public.knowledge_sources
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.knowledge_content_blobs, public.knowledge_sources
  TO app_backend, app_worker;

-- The organization row is retained for financial and audit obligations, so
-- delayed erasure must explicitly remove the separately deduplicated bytes.
CREATE OR REPLACE FUNCTION public.claim_due_account_erasures(max_count integer DEFAULT 50)
RETURNS TABLE(profile_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate record;
  owned_organizations uuid[];
  pseudonym text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF max_count < 1 OR max_count > 100 THEN
    RAISE EXCEPTION 'max_count must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  FOR candidate IN
    SELECT profile.id
    FROM public.profiles AS profile
    WHERE profile.deletion_requested_at <= now() - interval '30 days'
      AND (profile.erasure_claimed_at IS NULL OR profile.erasure_claimed_at < now() - interval '10 minutes')
    ORDER BY profile.deletion_requested_at, profile.id
    FOR UPDATE SKIP LOCKED
    LIMIT max_count
  LOOP
    UPDATE public.profiles AS profile
    SET erasure_claimed_at = now(), updated_at = now()
    WHERE profile.id = candidate.id;

    SELECT coalesce(array_agg(membership.organization_id), ARRAY[]::uuid[])
    INTO owned_organizations
    FROM public.organization_members AS membership
    WHERE membership.profile_id = candidate.id
      AND membership.role = 'OWNER'
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members AS other_owner
        WHERE other_owner.organization_id = membership.organization_id
          AND other_owner.profile_id <> candidate.id
          AND other_owner.role = 'OWNER'
      );

    pseudonym := substring(md5(candidate.id::text) FROM 1 FOR 16);
    DELETE FROM public.sites AS site
    WHERE site.organization_id = ANY(owned_organizations);
    DELETE FROM public.knowledge_sources AS knowledge_source
    WHERE knowledge_source.organization_id = ANY(owned_organizations);
    DELETE FROM public.knowledge_content_blobs AS knowledge_blob
    WHERE knowledge_blob.organization_id = ANY(owned_organizations);
    DELETE FROM public.notifications AS notification
    WHERE notification.profile_id = candidate.id;
    DELETE FROM public.idempotency_keys AS idempotency_key
    WHERE idempotency_key.profile_id = candidate.id;
    DELETE FROM public.terms_acceptances AS terms_acceptance
    WHERE terms_acceptance.profile_id = candidate.id;
    UPDATE public.job_runs AS job_run
    SET payload = '{"redacted":true}'::jsonb, result = NULL, error_code = NULL, error_message = NULL
    WHERE job_run.organization_id = ANY(owned_organizations);
    UPDATE public.audit_events AS audit_event
    SET actor_id = NULL, metadata = '{"redacted":true}'::jsonb
    WHERE audit_event.actor_id = candidate.id
       OR audit_event.organization_id = ANY(owned_organizations);
    UPDATE public.organizations AS organization
    SET name = 'Deleted organization ' || pseudonym,
        disabled_at = coalesce(organization.disabled_at, now()),
        updated_at = now()
    WHERE organization.id = ANY(owned_organizations);
    INSERT INTO public.audit_events (action, target_type, target_id, metadata)
    VALUES (
      'ACCOUNT_DATA_ERASED', 'profile_hash', pseudonym,
      jsonb_build_object('retained', jsonb_build_array('ledger', 'payment_intent', 'audit_event'))
    );

    profile_id := candidate.id;
    RETURN NEXT;
  END LOOP;
END;
$$;
ALTER FUNCTION public.claim_due_account_erasures(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_due_account_erasures(integer)
  FROM PUBLIC, anon, authenticated, app_backend, app_worker;
GRANT EXECUTE ON FUNCTION public.claim_due_account_erasures(integer) TO service_role;

-- No-opportunity is an expected, no-charge outcome rather than an error.
ALTER TABLE public.growth_runs ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.growth_runs ALTER COLUMN status TYPE text USING status::text;
DROP TYPE public."GrowthRunStatus";
CREATE TYPE public."GrowthRunStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'DELIVERED', 'SKIPPED',
  'BLOCKED', 'FAILED', 'CANCELLED'
);
ALTER TABLE public.growth_runs
  ALTER COLUMN status TYPE public."GrowthRunStatus"
    USING status::public."GrowthRunStatus",
  ALTER COLUMN status SET DEFAULT 'QUEUED';

-- allintitle/KGR is removed from the production contract. Decisions use real
-- demand, SERP evidence, intent, site fit, current rank, cost and risk.
ALTER TABLE public.opportunities ALTER COLUMN type TYPE text USING type::text;
DROP TYPE public."OpportunityType";
CREATE TYPE public."OpportunityType" AS ENUM (
  'CONTENT_GAP', 'EXISTING_PAGE', 'RANK_11_20',
  'HIGH_IMPRESSION_LOW_CTR', 'CONTENT_DECAY', 'INDEX_GAP', 'TOPIC_GAP',
  'TECHNICAL_BLOCK', 'INTERNAL_LINK_GAP', 'CANNIBALIZATION',
  'COMPETITOR_GAP', 'AI_CITATION_GAP', 'AI_MENTION_GAP', 'NEW_DEMAND'
);
ALTER TABLE public.opportunities
  ALTER COLUMN type TYPE public."OpportunityType"
    USING type::public."OpportunityType",
  DROP COLUMN allintitle_count,
  DROP COLUMN kgr_numerator,
  DROP COLUMN kgr_denominator;

-- Without GSC, DataForSEO rank is a leading indicator only. It never becomes
-- a traffic claim.
ALTER TABLE public.measurement_samples
  DROP CONSTRAINT measurement_samples_window_valid,
  ALTER COLUMN source TYPE text USING source::text;
DROP TYPE public."MeasurementSource";
CREATE TYPE public."MeasurementSource" AS ENUM (
  'GSC', 'LEADING_INDICATORS', 'DATAFORSEO_RANK'
);
ALTER TABLE public.measurement_samples
  ALTER COLUMN source TYPE public."MeasurementSource"
    USING source::public."MeasurementSource",
  ADD CONSTRAINT measurement_samples_window_valid CHECK (
    (source IN ('GSC', 'DATAFORSEO_RANK') AND window_days IN (14, 28, 56))
    OR (source = 'LEADING_INDICATORS' AND window_days = 7)
  );

INSERT INTO public.policy_versions (kind, version, config)
VALUES
  ('OPPORTUNITY_SCORE', 'opportunity-score-5', '{"formula":"demand*clickOpportunity*relevance*intent*siteFit*successProbability*confidence-cost-risk","allintitle":false,"minimumConfidenceMicros":550000}'::jsonb),
  ('QUALITY_GATE', 'quality-gate-4', '{"requiresVerifiedClaims":true,"requiresAllowedLinks":true,"maximumSourceOverlap":0.15,"refreshMode":"unique-bounded-local-patch","maximumRefreshTargetRatio":0.6}'::jsonb)
ON CONFLICT (kind, version) DO NOTHING;

COMMENT ON TABLE public.knowledge_content_blobs IS
  'Immutable organization-scoped evidence bytes deduplicated by checksum.';
COMMENT ON TABLE public.knowledge_sources IS
  'Immutable semantic source identities referencing deduplicated evidence bytes.';

DO $$
DECLARE
  before_row autonomous_growth_guard%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM autonomous_growth_guard;
  IF before_row.auth_user_count <> (SELECT count(*) FROM auth.users)
    OR before_row.profile_count <> (SELECT count(*) FROM public.profiles)
    OR before_row.organization_count <> (SELECT count(*) FROM public.organizations)
    OR before_row.member_count <> (SELECT count(*) FROM public.organization_members)
    OR before_row.site_count <> (SELECT count(*) FROM public.sites)
    OR before_row.integration_count <> (SELECT count(*) FROM public.integration_connections)
    OR before_row.payment_count <> (SELECT count(*) FROM public.payment_intents)
    OR before_row.ledger_count <> (SELECT count(*) FROM public.ledger_entries)
    OR before_row.balance_total <> (SELECT coalesce(sum(credit_balance_micros), 0) FROM public.organizations)
    OR before_row.ledger_total <> (SELECT coalesce(sum(amount_micros), 0) FROM public.ledger_entries)
    OR before_row.auth_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM auth.users row_value), '[]'::jsonb)::text)
    OR before_row.profile_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.profiles row_value), '[]'::jsonb)::text)
    OR before_row.organization_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.organizations row_value), '[]'::jsonb)::text)
    OR before_row.member_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.organization_id, row_value.profile_id) FROM public.organization_members row_value), '[]'::jsonb)::text)
    OR before_row.site_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.sites row_value), '[]'::jsonb)::text)
    OR before_row.integration_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.integration_connections row_value), '[]'::jsonb)::text)
    OR before_row.payment_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id) FROM public.payment_intents row_value), '[]'::jsonb)::text)
    OR before_row.ledger_hash <> md5(coalesce((SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.created_at, row_value.id) FROM public.ledger_entries row_value), '[]'::jsonb)::text)
  THEN
    RAISE EXCEPTION 'autonomous growth migration changed protected account, site or financial data';
  END IF;
END;
$$;
