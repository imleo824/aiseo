ALTER TYPE public."JobType" ADD VALUE IF NOT EXISTS 'AUTONOMOUS_EXECUTION';

ALTER TABLE public.worker_heartbeats
ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.action_prices (action, name, credit_micros, description, active, updated_at)
VALUES ('AUTONOMOUS_EXECUTION', '全自动 SEO 执行', 25000000, '真实来源抓取、DataForSEO 指标、AI 内容、质量门禁与站内链接', true, now())
ON CONFLICT (action) DO NOTHING;

CREATE TYPE public."ExecutionMode" AS ENUM ('ONCE', 'SCHEDULED');
CREATE TYPE public."ExecutionSourceType" AS ENUM ('KEYWORD', 'REWRITE_URL', 'COMPETITOR_URL');
CREATE TYPE public."ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_REVIEW', 'PUBLISHING', 'MONITORING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE public."ExecutionStage" AS ENUM ('INTAKE', 'SOURCE_CAPTURE', 'KEYWORD_RESEARCH', 'CONTENT_GENERATION', 'QUALITY_GATE', 'PUBLISHING', 'MONITORING', 'COMPLETED');

CREATE TABLE public.execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  automation_task_id uuid REFERENCES public.automation_tasks(id) ON DELETE SET NULL,
  job_run_id uuid UNIQUE REFERENCES public.job_runs(id) ON DELETE SET NULL,
  mode public."ExecutionMode" NOT NULL,
  source_type public."ExecutionSourceType" NOT NULL,
  source_value text NOT NULL,
  source_fingerprint text NOT NULL,
  status public."ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  stage public."ExecutionStage" NOT NULL DEFAULT 'INTAKE',
  resolved_keyword text,
  knowledge_source_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES public.content_drafts(id) ON DELETE SET NULL,
  result jsonb,
  error_code text,
  error_message text,
  started_at timestamp(3),
  finished_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT now(),
  updated_at timestamp(3) NOT NULL DEFAULT now(),
  CONSTRAINT execution_runs_org_fingerprint_key UNIQUE (organization_id, source_fingerprint),
  CONSTRAINT execution_runs_source_value_required CHECK (length(trim(source_value)) > 0),
  CONSTRAINT execution_runs_knowledge_sources_limit CHECK (cardinality(knowledge_source_ids) <= 20)
);

CREATE INDEX execution_runs_org_site_created_idx ON public.execution_runs(organization_id, site_id, created_at DESC);
CREATE INDEX execution_runs_status_stage_updated_idx ON public.execution_runs(status, stage, updated_at);
CREATE INDEX execution_runs_automation_created_idx ON public.execution_runs(automation_task_id, created_at DESC);
CREATE INDEX execution_runs_opportunity_idx ON public.execution_runs(opportunity_id);
CREATE INDEX execution_runs_draft_idx ON public.execution_runs(draft_id);

ALTER TABLE public.execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_select ON public.execution_runs FOR SELECT USING (private.can_access_organization(organization_id));
CREATE POLICY organization_insert ON public.execution_runs FOR INSERT WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_update ON public.execution_runs FOR UPDATE USING (private.can_mutate_organization(organization_id, 'EDITOR')) WITH CHECK (private.can_mutate_organization(organization_id, 'EDITOR'));
CREATE POLICY organization_delete ON public.execution_runs FOR DELETE USING (private.can_mutate_organization(organization_id, 'ADMIN'));

REVOKE ALL ON TABLE public.execution_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.execution_runs TO app_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.execution_runs TO app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend, app_worker;

COMMENT ON TABLE public.execution_runs IS 'Durable, resumable orchestration record shared by one-time and scheduled autonomous SEO executions.';
COMMENT ON COLUMN public.execution_runs.source_fingerprint IS 'Deterministic idempotency boundary for a single user request or schedule occurrence.';
