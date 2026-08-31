-- Search Growth State Machine. This shifts the product core from isolated
-- content jobs to a durable Reality -> Opportunity -> Decision -> Execution ->
-- Learning loop. Existing content tables remain as one possible action type.

-- This project has explicitly adopted the clean-cutover model. Refuse to drop
-- any legacy relation if data unexpectedly appeared after the preflight.
DO $legacy_cutover$
DECLARE
  relation_name text;
  row_count bigint;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'tenant_article_publish_logs', 'tenant_leads', 'tenant_articles', 'keywords',
    'workbench_run_steps', 'workbench_schedules', 'workbench_runs',
    'tenant_site_credentials', 'tenant_sites'
  ] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      IF relation_name = 'tenant_sites' THEN
        SELECT count(*) INTO row_count
        FROM public.tenant_sites
        WHERE tenant_id IS DISTINCT FROM 'tenant-dev'
           OR platform IS DISTINCT FROM 'shopify'
           OR connection_status IS DISTINCT FROM 'untested';
        IF row_count <> 0 THEN
          RAISE EXCEPTION 'clean cutover refused: public.tenant_sites contains % non-fixture rows', row_count;
        END IF;
      ELSE
        EXECUTE format('SELECT count(*) FROM public.%I', relation_name) INTO row_count;
        IF row_count <> 0 THEN
          RAISE EXCEPTION 'clean cutover refused: public.% contains % rows', relation_name, row_count;
        END IF;
      END IF;
    END IF;
  END LOOP;
END
$legacy_cutover$;

DROP TABLE IF EXISTS public.tenant_article_publish_logs;
DROP TABLE IF EXISTS public.tenant_leads;
DROP TABLE IF EXISTS public.tenant_articles;
DROP TABLE IF EXISTS public.keywords;
DROP TABLE IF EXISTS public.workbench_run_steps;
DROP TABLE IF EXISTS public.workbench_schedules;
DROP TABLE IF EXISTS public.workbench_runs;
DROP TABLE IF EXISTS public.tenant_site_credentials;
DROP TABLE IF EXISTS public.tenant_sites;

ALTER TYPE public."JobType" ADD VALUE IF NOT EXISTS 'GROWTH_CYCLE';
ALTER TYPE public."JobType" ADD VALUE IF NOT EXISTS 'GROWTH_ACTION_EXECUTE';
ALTER TYPE public."JobType" ADD VALUE IF NOT EXISTS 'GROWTH_MEASURE';

ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'RANK_11_20';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'HIGH_IMPRESSION_LOW_CTR';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'CONTENT_DECAY';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'INDEX_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'TOPIC_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'TECHNICAL_BLOCK';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'INTERNAL_LINK_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'CANNIBALIZATION';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'COMPETITOR_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'AI_CITATION_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'AI_MENTION_GAP';
ALTER TYPE public."OpportunityType" ADD VALUE IF NOT EXISTS 'NEW_DEMAND';

CREATE TYPE public."GrowthStateStatus" AS ENUM ('NEEDS_BASELINE', 'BASELINING', 'ACTIVE', 'OBSERVING', 'PAUSED', 'BLOCKED');
CREATE TYPE public."GrowthAutonomyLevel" AS ENUM ('OBSERVE_ONLY', 'GUIDED', 'AUTONOMOUS');
CREATE TYPE public."GrowthCycleTrigger" AS ENUM ('MANUAL_START', 'DATA_CHANGE', 'OBSERVATION_DUE', 'SCHEDULED_REFRESH', 'RECOVERY');
CREATE TYPE public."GrowthCycleStatus" AS ENUM ('QUEUED', 'RUNNING', 'OBSERVING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE public."GrowthStage" AS ENUM ('REALITY', 'OPPORTUNITY', 'DECISION', 'EXECUTION', 'LEARNING');
CREATE TYPE public."GrowthDecisionStatus" AS ENUM ('PROPOSED', 'SELECTED', 'DEFERRED', 'REJECTED', 'EXECUTED');
CREATE TYPE public."GrowthActionType" AS ENUM ('UPDATE_TITLE', 'ADD_INTERNAL_LINKS', 'CONTENT_REFRESH', 'ADD_CONTENT_SECTION', 'FIX_INDEXABILITY', 'CREATE_CONTENT', 'DIAGNOSE_ONLY');
CREATE TYPE public."GrowthActionStatus" AS ENUM ('PLANNED', 'REVIEW_REQUIRED', 'APPROVED', 'EXECUTING', 'VERIFYING', 'OBSERVING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');
CREATE TYPE public."GrowthRiskLevel" AS ENUM ('A', 'B', 'C', 'D');
CREATE TYPE public."GrowthAutonomyDecision" AS ENUM ('AUTO_EXECUTE', 'REQUIRE_REVIEW', 'REJECT');
CREATE TYPE public."GrowthObservationStatus" AS ENUM ('WAITING', 'ENOUGH_DATA', 'EVALUATED');
CREATE TYPE public."GrowthOutcome" AS ENUM ('WIN', 'NEUTRAL', 'LOSS', 'INCONCLUSIVE');

ALTER TABLE public.opportunities
  ADD COLUMN source_key text,
  ADD COLUMN title text,
  ADD COLUMN target_url text,
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN traffic_potential_micros bigint,
  ADD COLUMN business_relevance_micros bigint,
  ADD COLUMN success_probability_micros bigint,
  ADD COLUMN confidence_micros bigint,
  ADD COLUMN execution_cost_micros bigint,
  ADD COLUMN risk_penalty_micros bigint,
  ADD COLUMN expected_value_micros bigint,
  ADD COLUMN time_to_impact_days integer;

UPDATE public.opportunities SET title = keyword WHERE title IS NULL;
ALTER TABLE public.opportunities ALTER COLUMN title SET NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN keyword DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN search_volume DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN keyword_difficulty DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN allintitle_count DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN kgr_numerator DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN kgr_denominator DROP NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN roi_score_micros DROP NOT NULL;
ALTER TABLE public.opportunities ADD CONSTRAINT opportunities_nonnegative_growth_metrics CHECK (
  coalesce(traffic_potential_micros, 0) >= 0
  AND coalesce(business_relevance_micros, 0) BETWEEN 0 AND 1000000
  AND coalesce(success_probability_micros, 0) BETWEEN 0 AND 1000000
  AND coalesce(confidence_micros, 0) BETWEEN 0 AND 1000000
  AND coalesce(execution_cost_micros, 0) >= 0
  AND coalesce(risk_penalty_micros, 0) >= 0
  AND coalesce(expected_value_micros, 0) >= 0
  AND coalesce(time_to_impact_days, 0) >= 0
);
CREATE UNIQUE INDEX opportunities_site_id_source_key_key ON public.opportunities(site_id, source_key);
CREATE INDEX opportunities_site_status_expected_value_idx ON public.opportunities(site_id, status, expected_value_micros DESC);

CREATE TABLE public.site_growth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  status public."GrowthStateStatus" NOT NULL DEFAULT 'NEEDS_BASELINE',
  autonomy_level public."GrowthAutonomyLevel" NOT NULL DEFAULT 'OBSERVE_ONLY',
  state_version bigint NOT NULL DEFAULT 0,
  business_profile jsonb,
  protected_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline_completed_at timestamptz,
  last_cycle_at timestamptz,
  next_decision_at timestamptz,
  last_data_watermark timestamptz,
  paused_at timestamptz,
  blocked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_growth_states_version_nonnegative CHECK (state_version >= 0),
  CONSTRAINT site_growth_states_protected_paths_array CHECK (jsonb_typeof(protected_paths) = 'array')
);
CREATE INDEX site_growth_states_org_status_next_idx ON public.site_growth_states(organization_id, status, next_decision_at);

CREATE TABLE public.growth_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  job_run_id uuid UNIQUE REFERENCES public.job_runs(id) ON DELETE SET NULL,
  trigger public."GrowthCycleTrigger" NOT NULL,
  status public."GrowthCycleStatus" NOT NULL DEFAULT 'QUEUED',
  stage public."GrowthStage" NOT NULL DEFAULT 'REALITY',
  state_version bigint NOT NULL,
  input_watermark timestamptz,
  summary jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_cycles_version_nonnegative CHECK (state_version >= 0)
);
CREATE INDEX growth_cycles_org_site_created_idx ON public.growth_cycles(organization_id, site_id, created_at DESC);
CREATE INDEX growth_cycles_site_status_created_idx ON public.growth_cycles(site_id, status, created_at DESC);

CREATE TABLE public.growth_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL REFERENCES public.growth_cycles(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  status public."GrowthDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
  rank integer NOT NULL,
  score_micros bigint NOT NULL,
  score_version text NOT NULL,
  rationale jsonb NOT NULL,
  selected_action_type public."GrowthActionType",
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_decisions_cycle_opportunity_key UNIQUE(cycle_id, opportunity_id),
  CONSTRAINT growth_decisions_rank_positive CHECK (rank > 0),
  CONSTRAINT growth_decisions_score_nonnegative CHECK (score_micros >= 0)
);
CREATE INDEX growth_decisions_org_site_status_rank_idx ON public.growth_decisions(organization_id, site_id, status, rank);

CREATE TABLE public.growth_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL REFERENCES public.growth_cycles(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL UNIQUE REFERENCES public.growth_decisions(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  type public."GrowthActionType" NOT NULL,
  status public."GrowthActionStatus" NOT NULL DEFAULT 'PLANNED',
  risk_level public."GrowthRiskLevel" NOT NULL,
  autonomy_decision public."GrowthAutonomyDecision" NOT NULL,
  target_url text,
  reversible boolean NOT NULL DEFAULT false,
  plan jsonb NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  expected_value_micros bigint,
  observation_starts_at timestamptz,
  observe_until timestamptz,
  cooldown_until timestamptz,
  executed_at timestamptz,
  verified_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_actions_expected_value_nonnegative CHECK (coalesce(expected_value_micros, 0) >= 0),
  CONSTRAINT growth_actions_observation_window CHECK (observe_until IS NULL OR observation_starts_at IS NULL OR observe_until >= observation_starts_at),
  CONSTRAINT growth_actions_d_risk_never_autonomous CHECK (risk_level <> 'D' OR autonomy_decision = 'REJECT')
);
CREATE INDEX growth_actions_org_site_status_observe_idx ON public.growth_actions(organization_id, site_id, status, observe_until);
CREATE INDEX growth_actions_site_url_cooldown_idx ON public.growth_actions(site_id, target_url, cooldown_until);

CREATE TABLE public.growth_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES public.growth_actions(id) ON DELETE CASCADE,
  status public."GrowthObservationStatus" NOT NULL DEFAULT 'WAITING',
  source_snapshot_id uuid,
  baseline jsonb NOT NULL,
  measurement jsonb,
  control_measurement jsonb,
  estimated_lift_micros bigint,
  confidence_micros bigint,
  outcome public."GrowthOutcome",
  observed_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  CONSTRAINT growth_observations_confidence_range CHECK (confidence_micros IS NULL OR confidence_micros BETWEEN 0 AND 1000000)
);
CREATE INDEX growth_observations_org_site_status_observed_idx ON public.growth_observations(organization_id, site_id, status, observed_at DESC);
CREATE INDEX growth_observations_action_observed_idx ON public.growth_observations(action_id, observed_at DESC);

-- Cover every active foreign key whose referenced row can be updated/deleted.
-- Besides join speed, these indexes prevent long parent-row lock scans.
CREATE INDEX automation_tasks_site_id_idx ON public.automation_tasks(site_id);
CREATE INDEX content_drafts_opportunity_id_idx ON public.content_drafts(opportunity_id);
CREATE INDEX content_drafts_seo_snapshot_id_idx ON public.content_drafts(seo_snapshot_id);
CREATE INDEX content_drafts_site_id_idx ON public.content_drafts(site_id);
CREATE INDEX draft_reviews_reviewer_id_idx ON public.draft_reviews(reviewer_id);
CREATE INDEX idempotency_keys_organization_id_idx ON public.idempotency_keys(organization_id);
CREATE INDEX indexing_observations_site_id_idx ON public.indexing_observations(site_id);
CREATE INDEX keyword_scans_site_id_idx ON public.keyword_scans(site_id);
CREATE INDEX keyword_scans_snapshot_id_idx ON public.keyword_scans(snapshot_id);
CREATE INDEX knowledge_sources_site_id_idx ON public.knowledge_sources(site_id);
CREATE INDEX ledger_entries_payment_intent_id_idx ON public.ledger_entries(payment_intent_id);
CREATE INDEX notifications_profile_id_idx ON public.notifications(profile_id);
CREATE INDEX opportunities_keyword_scan_id_idx ON public.opportunities(keyword_scan_id);
CREATE INDEX opportunities_snapshot_id_idx ON public.opportunities(snapshot_id);
CREATE INDEX payment_intents_package_id_idx ON public.payment_intents(package_id);
CREATE INDEX terms_acceptances_organization_id_idx ON public.terms_acceptances(organization_id);
CREATE INDEX usage_records_job_run_id_idx ON public.usage_records(job_run_id);
CREATE INDEX growth_decisions_opportunity_id_idx ON public.growth_decisions(opportunity_id);
CREATE INDEX growth_actions_cycle_id_idx ON public.growth_actions(cycle_id);
CREATE INDEX growth_actions_opportunity_id_idx ON public.growth_actions(opportunity_id);

-- The original ALL policies also participated in SELECT, duplicating the
-- dedicated read policy. Split writes by operation to keep one SELECT policy.
DROP POLICY payment_packages_admin_write ON public.payment_packages;
CREATE POLICY payment_packages_admin_insert ON public.payment_packages FOR INSERT WITH CHECK (private.is_platform_admin());
CREATE POLICY payment_packages_admin_update ON public.payment_packages FOR UPDATE USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
CREATE POLICY payment_packages_admin_delete ON public.payment_packages FOR DELETE USING (private.is_platform_admin());
DROP POLICY action_prices_admin_write ON public.action_prices;
CREATE POLICY action_prices_admin_insert ON public.action_prices FOR INSERT WITH CHECK (private.is_platform_admin());
CREATE POLICY action_prices_admin_update ON public.action_prices FOR UPDATE USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
CREATE POLICY action_prices_admin_delete ON public.action_prices FOR DELETE USING (private.is_platform_admin());

DO $rls$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'site_growth_states', 'growth_cycles', 'growth_decisions', 'growth_actions', 'growth_observations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('CREATE POLICY organization_select ON public.%I FOR SELECT USING (private.can_access_organization(organization_id))', relation_name);
    EXECUTE format('CREATE POLICY organization_insert ON public.%I FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, %L))', relation_name, 'EDITOR');
    EXECUTE format('CREATE POLICY organization_update ON public.%I FOR UPDATE USING (private.can_mutate_organization(organization_id, %L)) WITH CHECK (private.can_mutate_organization(organization_id, %L))', relation_name, 'EDITOR', 'EDITOR');
    EXECUTE format('CREATE POLICY organization_delete ON public.%I FOR DELETE USING (private.can_mutate_organization(organization_id, %L))', relation_name, 'ADMIN');
  END LOOP;
END
$rls$;

REVOKE ALL ON TABLE public.site_growth_states, public.growth_cycles, public.growth_decisions, public.growth_actions, public.growth_observations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.site_growth_states, public.growth_cycles, public.growth_decisions, public.growth_actions, public.growth_observations TO app_backend, app_worker;
-- The Web process can start/pause a cycle but cannot manufacture decisions,
-- actions, or observations. Those evidence-bearing records are Worker-only.
GRANT INSERT, UPDATE ON TABLE public.site_growth_states, public.growth_cycles TO app_backend;
GRANT INSERT, UPDATE ON TABLE public.site_growth_states, public.growth_cycles, public.growth_decisions, public.growth_actions, public.growth_observations TO app_worker;
GRANT DELETE ON TABLE public.site_growth_states, public.growth_cycles, public.growth_decisions, public.growth_actions, public.growth_observations TO app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend, app_worker;

COMMENT ON TABLE public.site_growth_states IS 'Durable per-site search growth state; schedules and UI project from this state.';
COMMENT ON TABLE public.growth_actions IS 'Atomic, risk-scored, reversible changes with mandatory observation and cooldown windows.';
COMMENT ON COLUMN public.growth_observations.estimated_lift_micros IS 'Estimated incremental lift, never raw total traffic attributed to the action.';
