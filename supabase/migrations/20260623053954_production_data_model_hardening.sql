create extension if not exists pgcrypto;

create table if not exists public.tenant_site_credentials (
  id text primary key default gen_random_uuid()::text,
  tenant_id text not null default 'tenant-fk',
  site_id text not null references public.tenant_sites(id) on delete cascade,
  wp_app_password text,
  shopify_access_token text,
  shopify_refresh_token text,
  shopify_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_site_credentials_site_unique unique (site_id)
);

insert into public.tenant_site_credentials (
  tenant_id,
  site_id,
  wp_app_password,
  shopify_access_token,
  shopify_refresh_token,
  shopify_token_expires_at,
  created_at,
  updated_at
)
select
  coalesce(nullif(tenant_id, ''), 'tenant-fk'),
  id,
  wp_app_password,
  shopify_access_token,
  shopify_refresh_token,
  shopify_token_expires_at,
  now(),
  now()
from public.tenant_sites
where coalesce(wp_app_password, shopify_access_token, shopify_refresh_token, shopify_token_expires_at::text) is not null
on conflict (site_id) do update set
  tenant_id = excluded.tenant_id,
  wp_app_password = coalesce(excluded.wp_app_password, public.tenant_site_credentials.wp_app_password),
  shopify_access_token = coalesce(excluded.shopify_access_token, public.tenant_site_credentials.shopify_access_token),
  shopify_refresh_token = coalesce(excluded.shopify_refresh_token, public.tenant_site_credentials.shopify_refresh_token),
  shopify_token_expires_at = coalesce(excluded.shopify_token_expires_at, public.tenant_site_credentials.shopify_token_expires_at),
  updated_at = now();

alter table public.tenant_sites drop column if exists wp_app_password;
alter table public.tenant_sites drop column if exists shopify_access_token;
alter table public.tenant_sites drop column if exists shopify_refresh_token;
alter table public.tenant_sites drop column if exists shopify_token_expires_at;
alter table public.workbench_schedules drop column if exists sites;

alter table public.tenant_articles add column if not exists quality_before integer;
alter table public.tenant_articles add column if not exists quality_after integer;
alter table public.tenant_articles add column if not exists optimized boolean not null default false;
alter table public.tenant_articles add column if not exists quality_notes text[];
alter table public.tenant_articles add column if not exists published_at timestamptz;
alter table public.tenant_articles add column if not exists updated_at timestamptz not null default now();
alter table public.tenant_article_publish_logs add column if not exists wp_post_id integer;

do $$
begin
  if to_regclass('public.articles') is not null then
    execute $migrate_articles$
      insert into public.tenant_articles (
        id,
        tenant_id,
        site_id,
        keyword_id,
        title,
        content,
        meta_title,
        meta_description,
        focus_keyword,
        status,
        wp_post_id,
        published_url,
        publish_failure_code,
        publish_failure_message,
        publish_failure_details,
        publish_retriable,
        eeat_score,
        baidu_compliance_score,
        geo_citation_index,
        anti_spam_grade,
        has_auto_images,
        internal_links_count,
        quality_before,
        quality_after,
        optimized,
        quality_notes,
        created_at,
        updated_at
      )
      select
        coalesce(to_jsonb(a)->>'id', gen_random_uuid()::text),
        coalesce(nullif(to_jsonb(a)->>'tenant_id', ''), 'tenant-fk'),
        to_jsonb(a)->>'site_id',
        to_jsonb(a)->>'keyword_id',
        to_jsonb(a)->>'title',
        to_jsonb(a)->>'content',
        to_jsonb(a)->>'meta_title',
        to_jsonb(a)->>'meta_description',
        to_jsonb(a)->>'focus_keyword',
        case when to_jsonb(a)->>'status' in ('draft', 'published', 'failed') then to_jsonb(a)->>'status' else 'draft' end,
        nullif(to_jsonb(a)->>'wp_post_id', '')::integer,
        to_jsonb(a)->>'published_url',
        to_jsonb(a)->>'publish_failure_code',
        to_jsonb(a)->>'publish_failure_message',
        to_jsonb(a)->>'publish_failure_details',
        nullif(to_jsonb(a)->>'publish_retriable', '')::boolean,
        nullif(to_jsonb(a)->>'eeat_score', '')::integer,
        nullif(to_jsonb(a)->>'baidu_compliance_score', '')::integer,
        nullif(to_jsonb(a)->>'geo_citation_index', '')::integer,
        to_jsonb(a)->>'anti_spam_grade',
        nullif(to_jsonb(a)->>'has_auto_images', '')::boolean,
        nullif(to_jsonb(a)->>'internal_links_count', '')::integer,
        nullif(to_jsonb(a)->>'quality_before', '')::integer,
        nullif(to_jsonb(a)->>'quality_after', '')::integer,
        coalesce(nullif(to_jsonb(a)->>'optimized', '')::boolean, false),
        case
          when jsonb_typeof(to_jsonb(a)->'quality_notes') = 'array'
          then array(select jsonb_array_elements_text(to_jsonb(a)->'quality_notes'))
          else null
        end,
        coalesce(nullif(to_jsonb(a)->>'created_at', '')::timestamptz, now()),
        now()
      from public.articles a
      where to_jsonb(a)->>'site_id' is not null
        and to_jsonb(a)->>'title' is not null
        and to_jsonb(a)->>'content' is not null
      on conflict (id) do nothing
    $migrate_articles$;
  end if;
end $$;

update public.tenant_sites set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.workbench_runs set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.workbench_schedules set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.keywords set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.tenant_articles set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.tenant_article_publish_logs set tenant_id = 'tenant-fk' where tenant_id is null or tenant_id = '';
update public.tenant_leads set tenant_id = 'anonymous' where tenant_id is null or tenant_id = '';

alter table public.tenant_sites alter column tenant_id set default 'tenant-fk';
alter table public.tenant_sites alter column tenant_id set not null;
alter table public.workbench_runs alter column tenant_id set default 'tenant-fk';
alter table public.workbench_runs alter column tenant_id set not null;
alter table public.workbench_schedules alter column tenant_id set default 'tenant-fk';
alter table public.workbench_schedules alter column tenant_id set not null;
alter table public.keywords alter column tenant_id set default 'tenant-fk';
alter table public.keywords alter column tenant_id set not null;
alter table public.tenant_articles alter column tenant_id set default 'tenant-fk';
alter table public.tenant_articles alter column tenant_id set not null;
alter table public.tenant_article_publish_logs alter column tenant_id set default 'tenant-fk';
alter table public.tenant_article_publish_logs alter column tenant_id set not null;
alter table public.tenant_leads alter column tenant_id set default 'anonymous';
alter table public.tenant_leads alter column tenant_id set not null;

create index if not exists tenant_site_credentials_tenant_site_idx on public.tenant_site_credentials (tenant_id, site_id);
create index if not exists tenant_sites_tenant_status_idx on public.tenant_sites (tenant_id, status);
create index if not exists keywords_tenant_site_updated_idx on public.keywords (tenant_id, site_id, updated_at desc);
create index if not exists keywords_tenant_site_keyword_idx on public.keywords (tenant_id, site_id, lower(keyword));
create index if not exists tenant_articles_tenant_site_status_created_idx on public.tenant_articles (tenant_id, site_id, status, created_at desc);
create index if not exists tenant_articles_published_url_idx on public.tenant_articles (tenant_id, site_id, published_url) where published_url is not null;
create index if not exists tenant_article_publish_logs_tenant_site_created_idx on public.tenant_article_publish_logs (tenant_id, site_id, created_at desc);
create index if not exists tenant_leads_tenant_status_created_idx on public.tenant_leads (tenant_id, status, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'keywords_site_fk') then
    alter table public.keywords add constraint keywords_site_fk foreign key (site_id) references public.tenant_sites(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_articles_site_fk') then
    alter table public.tenant_articles add constraint tenant_articles_site_fk foreign key (site_id) references public.tenant_sites(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_article_publish_logs_site_fk') then
    alter table public.tenant_article_publish_logs add constraint tenant_article_publish_logs_site_fk foreign key (site_id) references public.tenant_sites(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_article_publish_logs_article_fk') then
    alter table public.tenant_article_publish_logs add constraint tenant_article_publish_logs_article_fk foreign key (article_id) references public.tenant_articles(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_leads_site_fk') then
    alter table public.tenant_leads add constraint tenant_leads_site_fk foreign key (site_id) references public.tenant_sites(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_leads_article_fk') then
    alter table public.tenant_leads add constraint tenant_leads_article_fk foreign key (article_id) references public.tenant_articles(id) on delete set null not valid;
  end if;
end $$;

alter table public.tenant_site_credentials enable row level security;

grant usage on schema public to service_role;
revoke all on table public.tenant_site_credentials from anon, authenticated;
grant all on table public.tenant_site_credentials to service_role;

comment on table public.tenant_site_credentials is 'Server-only connector credentials. Public APIs must read site metadata from tenant_sites and hydrate secrets only on trusted backend execution paths.';
comment on column public.tenant_sites.wp_username is 'Non-secret WordPress login identifier retained for operator visibility. Passwords live in tenant_site_credentials.';
comment on column public.workbench_schedules.site_ids is 'Authoritative scheduled site references. Runtime must load fresh site metadata and credentials by ID.';;
