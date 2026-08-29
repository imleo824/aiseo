-- Prisma generates UUIDs for normal application writes, but privileged SQL
-- functions also append immutable audit records directly. Database defaults
-- keep those trusted database-side paths correct and avoid coupling them to
-- an ORM implementation detail.
ALTER TABLE public.organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.sites ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.integration_connections ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.knowledge_sources ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.data_snapshots ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.keyword_scans ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.opportunities ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.automation_tasks ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.job_runs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.content_drafts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.draft_reviews ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.publish_attempts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.indexing_observations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.payment_intents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.ledger_entries ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.credit_holds ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.usage_records ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.idempotency_keys ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.audit_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.terms_acceptances ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.notifications ALTER COLUMN id SET DEFAULT gen_random_uuid();
