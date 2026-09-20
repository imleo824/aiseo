create extension if not exists pgcrypto;

create table if not exists public.workbench_runs (
  id text primary key,
  tenant_id text,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  title text not null,
  niche text not null default '',
  site_ids text[] not null default '{}',
  competitors text[] not null default '{}',
  publish_count integer not null default 1,
  summary jsonb not null default '{"totalTasks":0,"published":0,"pending":0,"failed":0}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workbench_run_steps (
  id text primary key,
  run_id text not null references public.workbench_runs(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('running', 'completed', 'warning', 'failed')),
  message text not null default '',
  details jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workbench_schedules (
  id text primary key,
  tenant_id text,
  name text not null,
  enabled boolean not null default true,
  site_ids text[] not null default '{}',
  sites jsonb,
  niche text not null default '',
  competitors text[] not null default '{}',
  publish_count integer not null default 1,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  time_of_day text not null default '09:00',
  day_of_week integer,
  day_of_month integer,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.keywords (
  id text primary key,
  tenant_id text,
  site_id text not null,
  keyword text not null,
  search_volume integer not null default 0,
  difficulty integer not null default 45,
  source text not null default '',
  intent text,
  status text not null default 'pending',
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_articles (
  id text primary key default gen_random_uuid()::text,
  tenant_id text,
  site_id text not null,
  keyword_id text,
  title text not null,
  content text not null,
  meta_title text,
  meta_description text,
  focus_keyword text,
  status text not null default 'draft' check (status in ('draft', 'published', 'failed')),
  wp_post_id integer,
  published_url text,
  publish_failure_code text,
  publish_failure_message text,
  publish_failure_details text,
  publish_retriable boolean,
  eeat_score integer,
  baidu_compliance_score integer,
  geo_citation_index integer,
  anti_spam_grade text,
  has_auto_images boolean,
  internal_links_count integer,
  source_competitor_domain text,
  source_competitor_url text,
  source_gap_status text,
  source_serp_intent text,
  source_content_type text,
  source_action_type text,
  source_publish_goal text,
  source_objective text,
  source_task_id text,
  source_expert_plan_id text,
  source_action_id text,
  source_brief jsonb,
  source_quality_v2 jsonb,
  source_platform text,
  source_metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_article_publish_logs (
  id text primary key default gen_random_uuid()::text,
  tenant_id text,
  site_id text not null,
  article_id text,
  platform text,
  status text not null,
  published_url text,
  message text,
  error text,
  payload jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workbench_runs_tenant_started_idx on public.workbench_runs (tenant_id, started_at desc);
create index if not exists workbench_run_steps_run_started_idx on public.workbench_run_steps (run_id, started_at);
create index if not exists workbench_schedules_due_idx on public.workbench_schedules (enabled, next_run_at);
create index if not exists workbench_schedules_tenant_idx on public.workbench_schedules (tenant_id);
create index if not exists keywords_site_updated_idx on public.keywords (site_id, updated_at desc);
create index if not exists tenant_articles_site_created_idx on public.tenant_articles (site_id, created_at desc);
create index if not exists tenant_article_publish_logs_article_idx on public.tenant_article_publish_logs (article_id, created_at desc);

alter table public.tenant_articles alter column id set default gen_random_uuid()::text;
alter table public.tenant_article_publish_logs alter column id set default gen_random_uuid()::text;

alter table public.tenant_articles add column if not exists keyword_id text;
alter table public.tenant_articles add column if not exists eeat_score integer;
alter table public.tenant_articles add column if not exists baidu_compliance_score integer;
alter table public.tenant_articles add column if not exists geo_citation_index integer;
alter table public.tenant_articles add column if not exists anti_spam_grade text;
alter table public.tenant_articles add column if not exists has_auto_images boolean;
alter table public.tenant_articles add column if not exists internal_links_count integer;
alter table public.tenant_articles add column if not exists source_competitor_domain text;
alter table public.tenant_articles add column if not exists source_competitor_url text;
alter table public.tenant_articles add column if not exists source_gap_status text;
alter table public.tenant_articles add column if not exists source_serp_intent text;
alter table public.tenant_articles add column if not exists source_content_type text;
alter table public.tenant_articles add column if not exists source_action_type text;
alter table public.tenant_articles add column if not exists source_publish_goal text;
alter table public.tenant_articles add column if not exists source_objective text;
alter table public.tenant_articles add column if not exists source_task_id text;
alter table public.tenant_articles add column if not exists source_expert_plan_id text;
alter table public.tenant_articles add column if not exists source_action_id text;
alter table public.tenant_articles add column if not exists source_brief jsonb;
alter table public.tenant_articles add column if not exists source_quality_v2 jsonb;
alter table public.tenant_articles add column if not exists source_platform text;
alter table public.tenant_articles add column if not exists source_metadata jsonb;
alter table public.tenant_article_publish_logs add column if not exists published_at timestamptz;
alter table public.tenant_article_publish_logs add column if not exists payload jsonb;

alter table public.tenant_sites enable row level security;
alter table public.workbench_runs enable row level security;
alter table public.workbench_run_steps enable row level security;
alter table public.workbench_schedules enable row level security;
alter table public.keywords enable row level security;
alter table public.tenant_articles enable row level security;
alter table public.tenant_article_publish_logs enable row level security;

revoke all on table public.tenant_sites from anon, authenticated;
revoke all on table public.workbench_runs from anon, authenticated;
revoke all on table public.workbench_run_steps from anon, authenticated;
revoke all on table public.workbench_schedules from anon, authenticated;
revoke all on table public.keywords from anon, authenticated;
revoke all on table public.tenant_articles from anon, authenticated;
revoke all on table public.tenant_article_publish_logs from anon, authenticated;

grant usage on schema public to service_role;
grant all on table public.tenant_sites to service_role;
grant all on table public.workbench_runs to service_role;
grant all on table public.workbench_run_steps to service_role;
grant all on table public.workbench_schedules to service_role;
grant all on table public.keywords to service_role;
grant all on table public.tenant_articles to service_role;
grant all on table public.tenant_article_publish_logs to service_role;;
