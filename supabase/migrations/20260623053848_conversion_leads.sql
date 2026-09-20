create table if not exists public.tenant_leads (
  id text primary key,
  tenant_id text,
  site_id text not null,
  article_id text,
  article_title text,
  name text not null,
  email_or_phone text not null,
  inquiry_details text,
  source_page text,
  lead_source text not null default 'aixeo_cta_form',
  event_name text not null default 'generate_lead',
  event_value numeric,
  event_currency text,
  ga_client_id text,
  ga_session_id text,
  ga4_status text not null default 'skipped' check (ga4_status in ('submitted', 'skipped', 'failed')),
  ga4_message text,
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'won', 'lost', 'spam')),
  created_at timestamptz not null default now()
);

create index if not exists tenant_leads_tenant_created_idx on public.tenant_leads (tenant_id, created_at desc);
create index if not exists tenant_leads_site_created_idx on public.tenant_leads (site_id, created_at desc);
create index if not exists tenant_leads_article_idx on public.tenant_leads (article_id, created_at desc);
create index if not exists tenant_leads_source_page_idx on public.tenant_leads (source_page);
create index if not exists tenant_leads_event_idx on public.tenant_leads (event_name, ga4_status);

alter table public.tenant_leads add column if not exists tenant_id text;
alter table public.tenant_leads add column if not exists site_id text;
alter table public.tenant_leads add column if not exists article_id text;
alter table public.tenant_leads add column if not exists article_title text;
alter table public.tenant_leads add column if not exists name text;
alter table public.tenant_leads add column if not exists email_or_phone text;
alter table public.tenant_leads add column if not exists inquiry_details text;
alter table public.tenant_leads add column if not exists source_page text;
alter table public.tenant_leads add column if not exists lead_source text not null default 'aixeo_cta_form';
alter table public.tenant_leads add column if not exists event_name text not null default 'generate_lead';
alter table public.tenant_leads add column if not exists event_value numeric;
alter table public.tenant_leads add column if not exists event_currency text;
alter table public.tenant_leads add column if not exists ga_client_id text;
alter table public.tenant_leads add column if not exists ga_session_id text;
alter table public.tenant_leads add column if not exists ga4_status text not null default 'skipped';
alter table public.tenant_leads add column if not exists ga4_message text;
alter table public.tenant_leads add column if not exists status text not null default 'new';
alter table public.tenant_leads add column if not exists created_at timestamptz not null default now();

alter table public.tenant_leads enable row level security;
revoke all on table public.tenant_leads from anon, authenticated;
grant all on table public.tenant_leads to service_role;

comment on table public.tenant_leads is 'Persisted SEO/GEO conversion evidence from CTA forms and GA4 generate_lead key-event sync status.';;
