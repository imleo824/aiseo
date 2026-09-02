-- One durable lifecycle for both one-time and continuous SEO growth programs.
-- Legacy run records are retained outside the public business schema, while
-- the duplicate execution/scheduler tables are removed from the runtime path.

CREATE TABLE IF NOT EXISTS private.legacy_growth_run_archive (
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  PRIMARY KEY (source_table, source_id)
);
REVOKE ALL ON TABLE private.legacy_growth_run_archive FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

INSERT INTO private.legacy_growth_run_archive (source_table, source_id, payload)
SELECT 'execution_runs', id, to_jsonb(execution_runs) FROM public.execution_runs
ON CONFLICT DO NOTHING;
INSERT INTO private.legacy_growth_run_archive (source_table, source_id, payload)
SELECT 'growth_cycles', id, to_jsonb(growth_cycles) FROM public.growth_cycles
ON CONFLICT DO NOTHING;
INSERT INTO private.legacy_growth_run_archive (source_table, source_id, payload)
SELECT 'automation_tasks', id, to_jsonb(automation_tasks) FROM public.automation_tasks
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS public.growth_observations;
DROP TABLE IF EXISTS public.growth_actions;
DROP TABLE IF EXISTS public.growth_decisions;
DROP TABLE IF EXISTS public.growth_cycles;
DROP TABLE IF EXISTS public.site_growth_states;
DROP TABLE IF EXISTS public.execution_runs;
DROP TABLE IF EXISTS public.automation_tasks;

DROP TYPE IF EXISTS public."GrowthStage";
DROP TYPE IF EXISTS public."GrowthCycleStatus";
DROP TYPE IF EXISTS public."GrowthCycleTrigger";
DROP TYPE IF EXISTS public."GrowthAutonomyLevel";
DROP TYPE IF EXISTS public."GrowthStateStatus";
DROP TYPE IF EXISTS public."ExecutionStage";
DROP TYPE IF EXISTS public."ExecutionStatus";
DROP TYPE IF EXISTS public."ExecutionSourceType";
DROP TYPE IF EXISTS public."ExecutionMode";
DROP TYPE IF EXISTS public."ScheduleType";
DROP TYPE IF EXISTS public."AutomationStatus";

ALTER TYPE public."JobType" ADD VALUE IF NOT EXISTS 'GROWTH_RUN';
ALTER TYPE public."GrowthOutcome" ADD VALUE IF NOT EXISTS 'NOT_READY' BEFORE 'WIN';

CREATE TYPE public."GrowthProgramMode" AS ENUM ('ONCE', 'CONTINUOUS');
CREATE TYPE public."GrowthInputType" AS ENUM ('KEYWORD', 'REFERENCE_URL', 'COMPETITOR_SITE');
CREATE TYPE public."GrowthProgramStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'BLOCKED');
CREATE TYPE public."GrowthRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_REVIEW', 'DELIVERED', 'BLOCKED', 'FAILED', 'CANCELLED');
CREATE TYPE public."GrowthRunStageCode" AS ENUM ('UNDERSTAND', 'DISCOVER', 'DECIDE', 'EXECUTE', 'LEARN');
CREATE TYPE public."GrowthRunStageStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'SKIPPED', 'BLOCKED', 'FAILED');
CREATE TYPE public."GrowthRunTrigger" AS ENUM ('USER', 'SCHEDULED', 'DATA_CHANGE', 'OBSERVATION');

CREATE TABLE public.growth_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  mode public."GrowthProgramMode" NOT NULL,
  input_type public."GrowthInputType" NOT NULL,
  input_value text NOT NULL,
  input_fingerprint text NOT NULL,
  status public."GrowthProgramStatus" NOT NULL DEFAULT 'ACTIVE',
  budget_limit_micros bigint,
  next_run_at timestamptz,
  last_run_at timestamptz,
  locked_until timestamptz,
  consecutive_wins integer NOT NULL DEFAULT 0,
  delivered_run_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_programs_org_fingerprint_key UNIQUE (organization_id, input_fingerprint),
  CONSTRAINT growth_programs_input_required CHECK (length(trim(input_value)) BETWEEN 1 AND 2048),
  CONSTRAINT growth_programs_budget_nonnegative CHECK (budget_limit_micros IS NULL OR budget_limit_micros >= 0),
  CONSTRAINT growth_programs_counts_nonnegative CHECK (consecutive_wins >= 0 AND delivered_run_count >= 0),
  CONSTRAINT growth_programs_schedule_shape CHECK (
    (mode = 'ONCE' AND next_run_at IS NULL)
    OR mode = 'CONTINUOUS'
  )
);
CREATE INDEX growth_programs_status_next_run_idx ON public.growth_programs(status, next_run_at) WHERE status = 'ACTIVE';
CREATE INDEX growth_programs_org_site_created_idx ON public.growth_programs(organization_id, site_id, created_at DESC);

CREATE TABLE public.growth_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.growth_programs(id) ON DELETE CASCADE,
  job_run_id uuid UNIQUE REFERENCES public.job_runs(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES public.content_drafts(id) ON DELETE SET NULL,
  trigger public."GrowthRunTrigger" NOT NULL,
  status public."GrowthRunStatus" NOT NULL DEFAULT 'QUEUED',
  current_stage public."GrowthRunStageCode" NOT NULL DEFAULT 'UNDERSTAND',
  occurrence_key text NOT NULL,
  resolved_keyword text,
  selected_action_type public."GrowthActionType",
  target_url text,
  knowledge_source_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  delivery jsonb,
  observation jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  delivered_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_runs_program_occurrence_key UNIQUE (program_id, occurrence_key),
  CONSTRAINT growth_runs_occurrence_required CHECK (length(trim(occurrence_key)) > 0),
  CONSTRAINT growth_runs_knowledge_sources_limit CHECK (cardinality(knowledge_source_ids) <= 50)
);
CREATE INDEX growth_runs_org_site_created_idx ON public.growth_runs(organization_id, site_id, created_at DESC);
CREATE INDEX growth_runs_program_status_created_idx ON public.growth_runs(program_id, status, created_at DESC);
CREATE INDEX growth_runs_site_status_updated_idx ON public.growth_runs(site_id, status, updated_at);
CREATE INDEX growth_runs_opportunity_idx ON public.growth_runs(opportunity_id);
CREATE INDEX growth_runs_draft_idx ON public.growth_runs(draft_id);

CREATE TABLE public.growth_run_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.growth_runs(id) ON DELETE CASCADE,
  stage public."GrowthRunStageCode" NOT NULL,
  status public."GrowthRunStageStatus" NOT NULL DEFAULT 'PENDING',
  summary text,
  processed_count integer NOT NULL DEFAULT 0,
  total_count integer,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_run_stages_run_stage_key UNIQUE (run_id, stage),
  CONSTRAINT growth_run_stages_progress_nonnegative CHECK (processed_count >= 0 AND (total_count IS NULL OR total_count >= processed_count)),
  CONSTRAINT growth_run_stages_evidence_array CHECK (jsonb_typeof(evidence) = 'array')
);
CREATE INDEX growth_run_stages_org_run_stage_idx ON public.growth_run_stages(organization_id, run_id, stage);
CREATE INDEX growth_run_stages_site_status_updated_idx ON public.growth_run_stages(site_id, status, updated_at);

CREATE TABLE public.growth_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.growth_runs(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE RESTRICT,
  status public."GrowthDecisionStatus" NOT NULL DEFAULT 'PROPOSED',
  rank integer NOT NULL,
  score_micros bigint NOT NULL,
  score_version text NOT NULL,
  rationale jsonb NOT NULL,
  selected_action_type public."GrowthActionType",
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_decisions_run_opportunity_key UNIQUE(run_id, opportunity_id),
  CONSTRAINT growth_decisions_rank_positive CHECK (rank > 0),
  CONSTRAINT growth_decisions_score_nonnegative CHECK (score_micros >= 0)
);
CREATE INDEX growth_decisions_org_site_status_rank_idx ON public.growth_decisions(organization_id, site_id, status, rank);
CREATE INDEX growth_decisions_opportunity_id_idx ON public.growth_decisions(opportunity_id);

CREATE TABLE public.growth_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.growth_runs(id) ON DELETE CASCADE,
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
CREATE INDEX growth_actions_run_id_idx ON public.growth_actions(run_id);
CREATE INDEX growth_actions_opportunity_id_idx ON public.growth_actions(opportunity_id);
CREATE UNIQUE INDEX growth_actions_one_active_site_mutation_idx ON public.growth_actions(site_id)
  WHERE status IN ('EXECUTING', 'VERIFYING');

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

-- Tenant identity is repeated on hot-path tables for fast RLS filtering. A
-- deferred integrity trigger ensures those denormalized organization/site ids
-- can never point at records owned by a different customer.
CREATE OR REPLACE FUNCTION private.enforce_growth_tenant_integrity()
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
    RAISE EXCEPTION 'growth record site does not belong to organization' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'growth_runs' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_programs program WHERE program.id = NEW.program_id AND program.organization_id = NEW.organization_id AND program.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth run program tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NEW.job_run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.job_runs job WHERE job.id = NEW.job_run_id AND job.organization_id = NEW.organization_id) THEN
      RAISE EXCEPTION 'growth run job tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.opportunities opportunity WHERE opportunity.id = NEW.opportunity_id AND opportunity.organization_id = NEW.organization_id AND opportunity.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth run opportunity tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NEW.draft_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.content_drafts draft WHERE draft.id = NEW.draft_id AND draft.organization_id = NEW.organization_id AND draft.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth run draft tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'growth_run_stages' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id AND run.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth stage run tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'growth_decisions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id AND run.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth decision run tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.opportunities opportunity WHERE opportunity.id = NEW.opportunity_id AND opportunity.organization_id = NEW.organization_id AND opportunity.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth decision opportunity tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'growth_actions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_runs run WHERE run.id = NEW.run_id AND run.organization_id = NEW.organization_id AND run.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth action run tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.growth_decisions decision WHERE decision.id = NEW.decision_id AND decision.run_id = NEW.run_id AND decision.organization_id = NEW.organization_id AND decision.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth action decision tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.opportunities opportunity WHERE opportunity.id = NEW.opportunity_id AND opportunity.organization_id = NEW.organization_id AND opportunity.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth action opportunity tenant does not match' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'growth_observations' THEN
    IF NOT EXISTS (SELECT 1 FROM public.growth_actions action WHERE action.id = NEW.action_id AND action.organization_id = NEW.organization_id AND action.site_id = NEW.site_id) THEN
      RAISE EXCEPTION 'growth observation action tenant does not match' USING ERRCODE = '23514';
    END IF;
    IF NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.data_snapshots snapshot WHERE snapshot.id = NEW.source_snapshot_id AND snapshot.organization_id = NEW.organization_id AND (snapshot.site_id IS NULL OR snapshot.site_id = NEW.site_id)) THEN
      RAISE EXCEPTION 'growth observation snapshot tenant does not match' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_growth_tenant_integrity() FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;

CREATE CONSTRAINT TRIGGER growth_programs_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_programs DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();
CREATE CONSTRAINT TRIGGER growth_runs_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_runs DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();
CREATE CONSTRAINT TRIGGER growth_run_stages_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_run_stages DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();
CREATE CONSTRAINT TRIGGER growth_decisions_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_decisions DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();
CREATE CONSTRAINT TRIGGER growth_actions_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_actions DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();
CREATE CONSTRAINT TRIGGER growth_observations_tenant_integrity AFTER INSERT OR UPDATE ON public.growth_observations DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.enforce_growth_tenant_integrity();

CREATE OR REPLACE FUNCTION private.touch_growth_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.touch_growth_updated_at() FROM PUBLIC, anon, authenticated, service_role, app_backend, app_worker;
CREATE TRIGGER growth_programs_touch_updated_at BEFORE UPDATE ON public.growth_programs FOR EACH ROW EXECUTE FUNCTION private.touch_growth_updated_at();
CREATE TRIGGER growth_runs_touch_updated_at BEFORE UPDATE ON public.growth_runs FOR EACH ROW EXECUTE FUNCTION private.touch_growth_updated_at();
CREATE TRIGGER growth_run_stages_touch_updated_at BEFORE UPDATE ON public.growth_run_stages FOR EACH ROW EXECUTE FUNCTION private.touch_growth_updated_at();
CREATE TRIGGER growth_decisions_touch_updated_at BEFORE UPDATE ON public.growth_decisions FOR EACH ROW EXECUTE FUNCTION private.touch_growth_updated_at();
CREATE TRIGGER growth_actions_touch_updated_at BEFORE UPDATE ON public.growth_actions FOR EACH ROW EXECUTE FUNCTION private.touch_growth_updated_at();

-- Account deletion must follow the unified scheduler. The former function
-- referenced automation_tasks, which no longer exists after this migration.
ALTER TABLE public.profiles ADD COLUMN erasure_claimed_at timestamptz;
CREATE INDEX profiles_due_erasure_idx ON public.profiles(deletion_requested_at, erasure_claimed_at)
  WHERE deletion_requested_at IS NOT NULL;
ALTER TABLE public.draft_reviews DROP CONSTRAINT draft_reviews_reviewer_id_fkey;
ALTER TABLE public.draft_reviews ADD CONSTRAINT draft_reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.terms_acceptances DROP CONSTRAINT terms_acceptances_profile_id_fkey;
ALTER TABLE public.terms_acceptances ADD CONSTRAINT terms_acceptances_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION private.request_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_profile uuid := private.current_profile_id();
  existing_request timestamptz;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'profile context is required' USING ERRCODE = '22023';
  END IF;
  SELECT deletion_requested_at INTO existing_request
  FROM public.profiles WHERE id = current_profile FOR UPDATE;
  IF existing_request IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.organizations organization
  SET disabled_at = now(), updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.organization_members membership
    WHERE membership.organization_id = organization.id
      AND membership.profile_id = current_profile AND membership.role = 'OWNER'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.organization_members other_owner
    WHERE other_owner.organization_id = organization.id
      AND other_owner.profile_id <> current_profile AND other_owner.role = 'OWNER'
  );
  UPDATE public.growth_programs program
  SET status = 'PAUSED', next_run_at = NULL, locked_until = NULL,
      last_error = 'Account deletion requested', updated_at = now()
  WHERE EXISTS (
    SELECT 1 FROM public.organizations organization
    WHERE organization.id = program.organization_id
      AND organization.disabled_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.organization_members membership
        WHERE membership.organization_id = organization.id
          AND membership.profile_id = current_profile
      )
  );
  DELETE FROM public.organization_members membership
  WHERE membership.profile_id = current_profile
    AND EXISTS (
      SELECT 1 FROM public.organization_members other_owner
      WHERE other_owner.organization_id = membership.organization_id
        AND other_owner.profile_id <> current_profile AND other_owner.role = 'OWNER'
    );
  UPDATE public.profiles
  SET deletion_requested_at = now(), suspended_at = now(), updated_at = now()
  WHERE id = current_profile;
  INSERT INTO public.audit_events (actor_id, action, target_type, target_id, metadata)
  VALUES (
    current_profile, 'ACCOUNT_DELETION_REQUESTED', 'profile', current_profile::text,
    jsonb_build_object('purgeAfter', now() + interval '30 days')
  );
END;
$$;
ALTER FUNCTION private.request_account_deletion() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.request_account_deletion() FROM PUBLIC, anon, authenticated, service_role, app_worker;
GRANT EXECUTE ON FUNCTION private.request_account_deletion() TO app_backend;

-- This is the only business-data capability granted to the isolated Edge
-- Function service role. It atomically claims due accounts, purges customer
-- content and credentials, and de-identifies retained financial/audit records
-- before the Edge Function removes the corresponding Auth user.
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
    FROM public.profiles profile
    WHERE profile.deletion_requested_at <= now() - interval '30 days'
      AND (profile.erasure_claimed_at IS NULL OR profile.erasure_claimed_at < now() - interval '10 minutes')
    ORDER BY profile.deletion_requested_at, profile.id
    FOR UPDATE SKIP LOCKED
    LIMIT max_count
  LOOP
    UPDATE public.profiles SET erasure_claimed_at = now(), updated_at = now()
    WHERE id = candidate.id;

    SELECT coalesce(array_agg(membership.organization_id), ARRAY[]::uuid[])
    INTO owned_organizations
    FROM public.organization_members membership
    WHERE membership.profile_id = candidate.id
      AND membership.role = 'OWNER'
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members other_owner
        WHERE other_owner.organization_id = membership.organization_id
          AND other_owner.profile_id <> candidate.id
          AND other_owner.role = 'OWNER'
      );

    pseudonym := substring(md5(candidate.id::text) FROM 1 FOR 16);
    DELETE FROM public.sites WHERE organization_id = ANY(owned_organizations);
    DELETE FROM public.knowledge_sources WHERE organization_id = ANY(owned_organizations);
    DELETE FROM public.notifications WHERE profile_id = candidate.id;
    DELETE FROM public.idempotency_keys WHERE profile_id = candidate.id;
    DELETE FROM public.terms_acceptances WHERE profile_id = candidate.id;
    UPDATE public.job_runs
    SET payload = '{"redacted":true}'::jsonb, result = NULL, error_code = NULL, error_message = NULL
    WHERE organization_id = ANY(owned_organizations);
    UPDATE public.audit_events
    SET actor_id = NULL, metadata = '{"redacted":true}'::jsonb
    WHERE actor_id = candidate.id OR organization_id = ANY(owned_organizations);
    UPDATE public.organizations
    SET name = 'Deleted organization ' || pseudonym, disabled_at = coalesce(disabled_at, now()), updated_at = now()
    WHERE id = ANY(owned_organizations);
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
REVOKE ALL ON FUNCTION public.claim_due_account_erasures(integer) FROM PUBLIC, anon, authenticated, app_backend, app_worker;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_account_erasures(integer) TO service_role;

ALTER TABLE public.growth_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_programs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_run_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_run_stages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_actions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.growth_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_observations FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_select ON public.growth_programs FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_programs FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_programs FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_programs FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_select ON public.growth_runs FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_runs FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_runs FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_runs FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_select ON public.growth_run_stages FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_run_stages FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_run_stages FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_run_stages FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_select ON public.growth_decisions FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_decisions FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_decisions FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_decisions FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_select ON public.growth_actions FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_actions FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_actions FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_actions FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));
CREATE POLICY organization_select ON public.growth_observations FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.growth_observations FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.growth_observations FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.growth_observations FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));

REVOKE ALL ON TABLE public.growth_programs, public.growth_runs, public.growth_run_stages,
  public.growth_decisions, public.growth_actions, public.growth_observations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.growth_programs, public.growth_runs TO app_backend;
GRANT SELECT, INSERT ON TABLE public.growth_run_stages TO app_backend;
GRANT SELECT, UPDATE ON TABLE public.growth_actions TO app_backend;
GRANT SELECT ON TABLE public.growth_decisions, public.growth_observations TO app_backend;
GRANT SELECT, INSERT, UPDATE ON TABLE public.growth_programs, public.growth_runs, public.growth_run_stages,
  public.growth_decisions, public.growth_actions, public.growth_observations TO app_worker;

INSERT INTO public.action_prices (action, name, credit_micros, description, active, updated_at)
VALUES ('GROWTH_RUN', '自然流量增长执行', 25000000, '网站理解、真实搜索数据、机会决策、内容执行与效果观察', true, now())
ON CONFLICT (action) DO UPDATE SET name = excluded.name, description = excluded.description, active = true, updated_at = now();
UPDATE public.action_prices SET active = false, updated_at = now()
WHERE action IN ('AUTONOMOUS_EXECUTION', 'GROWTH_CYCLE', 'GROWTH_ACTION_EXECUTE', 'GROWTH_MEASURE');

COMMENT ON TABLE public.growth_programs IS 'Customer growth intent shared by one-time and continuous execution modes.';
COMMENT ON TABLE public.growth_runs IS 'One durable execution attempt whose state is only advanced by committed worker results.';
COMMENT ON TABLE public.growth_run_stages IS 'Five user-facing stages with evidence, counts and timestamps committed with their artifacts.';
