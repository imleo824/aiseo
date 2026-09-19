-- The unified engine produces exactly one selected action and at most one
-- deliverable draft per growth run. Enforce those invariants in Postgres so
-- API code never has to choose an arbitrary relation row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.growth_actions GROUP BY run_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'growth_actions contains more than one action for a growth run';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.growth_runs WHERE draft_id IS NOT NULL GROUP BY draft_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'growth_runs contains a draft linked to more than one run';
  END IF;
  IF EXISTS (SELECT 1 FROM public.content_drafts WHERE status::text = 'APPROVED') THEN
    RAISE EXCEPTION 'content_drafts contains obsolete APPROVED state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.growth_actions WHERE status::text = 'APPROVED') THEN
    RAISE EXCEPTION 'growth_actions contains obsolete APPROVED state';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.growth_runs_draft_idx;
DROP INDEX IF EXISTS public.growth_actions_run_id_idx;
CREATE UNIQUE INDEX growth_runs_draft_id_key
  ON public.growth_runs(draft_id);
CREATE UNIQUE INDEX growth_actions_run_id_key
  ON public.growth_actions(run_id);

-- Remove unreachable transitional enum values and add an explicit SKIPPED
-- publish-attempt outcome for a queued automatic publish that is converted to
-- manual review before any WordPress mutation occurs.
ALTER TABLE public.content_drafts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.content_drafts ALTER COLUMN status TYPE text USING status::text;
DROP TYPE public."DraftStatus";
CREATE TYPE public."DraftStatus" AS ENUM (
  'GENERATING',
  'QUALITY_FAILED',
  'PENDING_REVIEW',
  'REJECTED',
  'PUBLISHING',
  'PUBLISHED',
  'PUBLISH_FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK'
);
ALTER TABLE public.content_drafts
  ALTER COLUMN status TYPE public."DraftStatus" USING status::public."DraftStatus",
  ALTER COLUMN status SET DEFAULT 'GENERATING';

ALTER TABLE public.growth_actions ALTER COLUMN status DROP DEFAULT;
-- PostgreSQL reparses partial-index predicates while changing a column type.
-- The predicate constants below are bound to the old enum, so retaining the
-- index during the intermediate text cast would compare text to that enum and
-- abort the migration. Recreate the same invariant after the new enum exists.
DROP INDEX IF EXISTS public.growth_actions_one_active_site_mutation_idx;
ALTER TABLE public.growth_actions ALTER COLUMN status TYPE text USING status::text;
DROP TYPE public."GrowthActionStatus";
CREATE TYPE public."GrowthActionStatus" AS ENUM (
  'PLANNED',
  'REVIEW_REQUIRED',
  'EXECUTING',
  'VERIFYING',
  'OBSERVING',
  'SUCCEEDED',
  'FAILED',
  'ROLLED_BACK',
  'CANCELLED'
);
ALTER TABLE public.growth_actions
  ALTER COLUMN status TYPE public."GrowthActionStatus" USING status::public."GrowthActionStatus",
  ALTER COLUMN status SET DEFAULT 'PLANNED';
CREATE UNIQUE INDEX growth_actions_one_active_site_mutation_idx ON public.growth_actions(site_id)
  WHERE status IN ('EXECUTING', 'VERIFYING');

ALTER TABLE public.publish_attempts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.publish_attempts ALTER COLUMN status TYPE text USING status::text;
DROP TYPE public."PublishAttemptStatus";
CREATE TYPE public."PublishAttemptStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'SKIPPED',
  'FAILED',
  'ROLLED_BACK'
);
ALTER TABLE public.publish_attempts
  ALTER COLUMN status TYPE public."PublishAttemptStatus" USING status::public."PublishAttemptStatus",
  ALTER COLUMN status SET DEFAULT 'QUEUED';

-- Profile-scoped records cannot inherit the generic organization-wide read
-- policy. A workspace member must never see another member's private
-- notification, terms record or actor-level audit metadata merely because
-- they share an organization.
DROP POLICY IF EXISTS organization_select ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select ON public.terms_acceptances FOR SELECT
  USING (
    profile_id = private.current_profile_id()
    OR private.is_worker()
    OR private.is_platform_admin()
  );

DROP POLICY IF EXISTS organization_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT
  USING (
    (profile_id IS NULL AND private.can_access_organization(organization_id))
    OR profile_id = private.current_profile_id()
    OR private.is_worker()
    OR private.is_platform_admin()
  );

DROP POLICY IF EXISTS organization_select ON public.audit_events;
CREATE POLICY audit_events_select ON public.audit_events FOR SELECT
  USING (
    actor_id = private.current_profile_id()
    OR private.can_mutate_organization(organization_id, 'ADMIN')
    OR private.is_worker()
    OR private.is_platform_admin()
  );
