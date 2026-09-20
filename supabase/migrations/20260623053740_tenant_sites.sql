create table if not exists public.tenant_sites (
  id text primary key,
  tenant_id text,
  platform text not null default 'wordpress' check (platform in ('wordpress', 'shopify')),
  name text not null,
  url text not null,
  wp_username text not null default '',
  wp_app_password text,
  shopify_shop_domain text,
  shopify_access_token text,
  shopify_refresh_token text,
  shopify_scopes text[],
  shopify_token_expires_at timestamptz,
  shopify_connection_status text check (shopify_connection_status in ('connected', 'failed', 'untested', 'disconnected')),
  target_category_id integer not null default 1,
  niche text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  daily_limit integer not null default 5,
  connection_status text not null default 'untested' check (connection_status in ('connected', 'failed', 'untested', 'disconnected')),
  last_verified_at timestamptz,
  last_sync_at timestamptz,
  wp_user_id integer,
  wp_user_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_sites_tenant_id_idx on public.tenant_sites (tenant_id);
create index if not exists tenant_sites_status_idx on public.tenant_sites (status);
create index if not exists tenant_sites_platform_idx on public.tenant_sites (platform);

alter table public.tenant_sites add column if not exists platform text not null default 'wordpress';
alter table public.tenant_sites add column if not exists shopify_shop_domain text;
alter table public.tenant_sites add column if not exists shopify_access_token text;
alter table public.tenant_sites add column if not exists shopify_refresh_token text;
alter table public.tenant_sites add column if not exists shopify_scopes text[];
alter table public.tenant_sites add column if not exists shopify_token_expires_at timestamptz;
alter table public.tenant_sites add column if not exists shopify_connection_status text;

comment on table public.tenant_sites is 'AIXEO site connections for WordPress and Shopify. Credentials and tokens should be protected by server-side access controls.';;
