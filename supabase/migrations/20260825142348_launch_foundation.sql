-- Production launch foundation. Apply through `supabase db push`; do not grant
-- browser roles direct access to these business tables.
create extension if not exists pgcrypto;

-- Private object storage for future source files and generated media. Application
-- workers access it with server-side credentials; browser roles receive no policy.
insert into storage.buckets (id, name, public) values ('seo-assets', 'seo-assets', false)
on conflict (id) do nothing;

create type public.platform_role as enum ('USER', 'PLATFORM_ADMIN');
create type public.organization_role as enum ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
create type public.job_type as enum ('GSC_SYNC', 'DATAFORSEO_SERP', 'CONTENT_GENERATION', 'WORDPRESS_PUBLISH', 'PAYMENT_VERIFY');
create type public.job_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');
create type public.data_source as enum ('GSC', 'DATAFORSEO');
create type public.data_status as enum ('LIVE', 'PENDING', 'UNAVAILABLE', 'STALE');
create type public.payment_status as enum ('CREATED', 'AWAITING_CONFIRMATION', 'VERIFIED', 'CREDITED', 'REJECTED', 'EXPIRED');
create type public.ledger_entry_type as enum ('CREDIT', 'RESERVATION', 'CONSUMPTION', 'REFUND', 'ADJUSTMENT');
create type public.credit_hold_status as enum ('HELD', 'SETTLED', 'RELEASED');
create type public.draft_status as enum ('GENERATING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED', 'PUBLISH_FAILED');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text not null unique,
  password_hash text not null,
  platform_role public.platform_role not null default 'USER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  credit_balance integer not null default 0 check (credit_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_organization_idx on public.organization_members(user_id, organization_id);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index sessions_user_expires_idx on public.sessions(user_id, expires_at);
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null,
  name text not null,
  language text not null default 'zh-CN',
  wordpress_credentials bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, domain)
);
create index sites_organization_created_idx on public.sites(organization_id, created_at desc);
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider public.data_source not null,
  encrypted_credentials bytea not null,
  key_version integer not null,
  status public.data_status not null default 'PENDING',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
create table public.data_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  source public.data_source not null,
  status public.data_status not null,
  provider_task_id text,
  fetched_at timestamptz not null default now(),
  available_from timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index data_snapshots_org_source_fetched_idx on public.data_snapshots(organization_id, source, fetched_at desc);
create index data_snapshots_site_source_fetched_idx on public.data_snapshots(site_id, source, fetched_at desc);
create index data_snapshots_provider_task_idx on public.data_snapshots(provider_task_id) where provider_task_id is not null;
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.job_type not null,
  status public.job_status not null default 'QUEUED',
  idempotency_key text,
  queue_job_id text unique,
  attempts integer not null default 0 check (attempts >= 0),
  payload jsonb not null,
  result jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, type, idempotency_key)
);
create index job_runs_org_status_created_idx on public.job_runs(organization_id, status, created_at desc);
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  network text not null default 'TRC20' check (network = 'TRC20'),
  recipient_address text not null,
  expected_amount_micros bigint not null check (expected_amount_micros > 0),
  credits integer not null check (credits > 0),
  tx_hash text unique,
  status public.payment_status not null default 'CREATED',
  verification jsonb,
  expires_at timestamptz not null,
  verified_at timestamptz,
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_intents_org_status_created_idx on public.payment_intents(organization_id, status, created_at desc);
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type public.ledger_entry_type not null,
  amount integer not null check (amount <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  idempotency_key text unique,
  payment_intent_id uuid references public.payment_intents(id) on delete restrict,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index ledger_entries_org_created_idx on public.ledger_entries(organization_id, created_at desc);
create table public.credit_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_run_id uuid unique references public.job_runs(id) on delete cascade,
  amount integer not null check (amount > 0),
  status public.credit_hold_status not null default 'HELD',
  reason text not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  released_at timestamptz
);
create index credit_holds_org_status_idx on public.credit_holds(organization_id, status);
create table public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  status public.draft_status not null default 'GENERATING',
  title text not null,
  html text not null,
  quality_report jsonb not null,
  data_provenance jsonb not null,
  published_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_drafts_org_site_status_created_idx on public.content_drafts(organization_id, site_id, status, created_at desc);
create table public.publish_approvals (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.content_drafts(id) on delete cascade,
  approved_by uuid not null references public.users(id) on delete restrict,
  comment text,
  created_at timestamptz not null default now()
);
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  key text not null,
  request_hash text not null,
  response jsonb,
  status_code integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique nulls not distinct (organization_id, key)
);
create index idempotency_keys_expiry_idx on public.idempotency_keys(expires_at);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_org_created_idx on public.audit_events(organization_id, created_at desc);
create index audit_events_actor_created_idx on public.audit_events(actor_id, created_at desc);

-- RLS is a defense-in-depth guard for future Data API use. The application
-- connects with a non-owner role and sets these variables inside each request
-- transaction; browser roles are deliberately granted no business-table access.
create schema if not exists private;
create function private.current_organization_id() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('app.organization_id', true), '')::uuid
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sites enable row level security;
alter table public.integration_connections enable row level security;
alter table public.data_snapshots enable row level security;
alter table public.job_runs enable row level security;
alter table public.payment_intents enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.credit_holds enable row level security;
alter table public.content_drafts enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.audit_events enable row level security;
alter table public.users enable row level security;
alter table public.sessions enable row level security;
alter table public.publish_approvals enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create policy organization_scope on public.organizations using (id = (select private.current_organization_id())) with check (id = (select private.current_organization_id()));
create policy organization_members_scope on public.organization_members using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy sites_scope on public.sites using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy integration_connections_scope on public.integration_connections using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy data_snapshots_scope on public.data_snapshots using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy job_runs_scope on public.job_runs using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy payment_intents_scope on public.payment_intents using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy ledger_entries_scope on public.ledger_entries using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy credit_holds_scope on public.credit_holds using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy content_drafts_scope on public.content_drafts using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy idempotency_keys_scope on public.idempotency_keys using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));
create policy audit_events_scope on public.audit_events using (organization_id = (select private.current_organization_id())) with check (organization_id = (select private.current_organization_id()));

-- The following owner-only tables have no client grants. Their policies deny
-- accidental Data API access until a dedicated client-facing auth design exists.
create policy deny_direct_users on public.users using (false) with check (false);
create policy deny_direct_sessions on public.sessions using (false) with check (false);
create policy deny_direct_approvals on public.publish_approvals using (false) with check (false);
