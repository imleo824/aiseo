alter table public.keywords add column if not exists priority_score integer;
alter table public.keywords add column if not exists serp_intent text;
alter table public.keywords add column if not exists content_type text;
alter table public.keywords add column if not exists data_confidence text not null default 'low';
alter table public.keywords add column if not exists evidence_sources jsonb not null default '[]'::jsonb;
alter table public.keywords add column if not exists metric_source text not null default 'unverified';
alter table public.keywords add column if not exists metric_provenance jsonb not null default '{}'::jsonb;
alter table public.keywords add column if not exists opportunity_reason text;
alter table public.keywords add column if not exists strategy_reasoning jsonb;
alter table public.keywords add column if not exists score_breakdown jsonb;
alter table public.keywords add column if not exists competitor_domains text[] not null default '{}';
alter table public.keywords add column if not exists my_rank numeric(8,2);
alter table public.keywords add column if not exists gsc_impressions integer;
alter table public.keywords add column if not exists gsc_clicks integer;
alter table public.keywords add column if not exists gsc_ctr numeric(8,4);
alter table public.keywords add column if not exists serp_rank numeric(8,2);
alter table public.keywords add column if not exists conversion_score integer;
alter table public.keywords add column if not exists cannibalization_risk text;
alter table public.keywords add column if not exists last_market_data_at timestamptz;

alter table public.keywords alter column difficulty set default 0;

update public.keywords
set
  search_volume = greatest(coalesce(search_volume, 0), 0),
  difficulty = least(greatest(coalesce(difficulty, 0), 0), 100),
  data_confidence = coalesce(nullif(data_confidence, ''), 'low'),
  evidence_sources = case
    when jsonb_typeof(coalesce(evidence_sources, '[]'::jsonb)) = 'array' then coalesce(evidence_sources, '[]'::jsonb)
    else '[]'::jsonb
  end,
  metric_source = coalesce(nullif(metric_source, ''), 'unverified'),
  metric_provenance = case
    when jsonb_typeof(coalesce(metric_provenance, '{}'::jsonb)) = 'object' then coalesce(metric_provenance, '{}'::jsonb)
    else '{}'::jsonb
  end,
  competitor_domains = coalesce(competitor_domains, '{}');

update public.keywords
set
  search_volume = 0,
  difficulty = 0,
  data_confidence = 'low',
  metric_source = 'unverified',
  metric_provenance = jsonb_build_object(
    'searchVolume', jsonb_build_object(
      'provider', 'unverified',
      'status', 'not_available',
      'evidence', 'Legacy keyword row had no provider-level provenance; search volume was reset to unverified.',
      'fetchedAt', now()
    ),
    'difficulty', jsonb_build_object(
      'provider', 'unverified',
      'status', 'not_available',
      'evidence', 'Legacy keyword row had no provider-level provenance; difficulty was reset to unverified.',
      'fetchedAt', now()
    ),
    'notes', jsonb_build_array('Production migration requires provider provenance before numeric keyword metrics can affect decisions.')
  )
where metric_source = 'unverified'
  and jsonb_array_length(evidence_sources) = 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'keywords_search_volume_nonnegative') then
    alter table public.keywords add constraint keywords_search_volume_nonnegative check (search_volume >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keywords_difficulty_range') then
    alter table public.keywords add constraint keywords_difficulty_range check (difficulty between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keywords_priority_score_range') then
    alter table public.keywords add constraint keywords_priority_score_range check (priority_score is null or priority_score between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keywords_data_confidence_check') then
    alter table public.keywords add constraint keywords_data_confidence_check check (data_confidence in ('high', 'medium', 'low')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keywords_metric_source_check') then
    alter table public.keywords add constraint keywords_metric_source_check check (metric_source in ('gsc', 'semrush', 'ahrefs', 'serp', 'site-crawl', 'conversion', 'mock', 'mixed', 'manual', 'unverified')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'keywords_cannibalization_risk_check') then
    alter table public.keywords add constraint keywords_cannibalization_risk_check check (cannibalization_risk is null or cannibalization_risk in ('low', 'medium', 'high')) not valid;
  end if;
end $$;

alter table public.keywords validate constraint keywords_search_volume_nonnegative;
alter table public.keywords validate constraint keywords_difficulty_range;
alter table public.keywords validate constraint keywords_priority_score_range;
alter table public.keywords validate constraint keywords_data_confidence_check;
alter table public.keywords validate constraint keywords_metric_source_check;
alter table public.keywords validate constraint keywords_cannibalization_risk_check;

create index if not exists keywords_tenant_site_priority_idx
  on public.keywords (tenant_id, site_id, priority_score desc nulls last, updated_at desc);

create index if not exists keywords_tenant_site_confidence_idx
  on public.keywords (tenant_id, site_id, data_confidence, metric_source);

create index if not exists keywords_evidence_sources_gin_idx
  on public.keywords using gin (evidence_sources);

create index if not exists keywords_metric_provenance_gin_idx
  on public.keywords using gin (metric_provenance);

revoke all on table public.keywords from anon, authenticated;
grant all on table public.keywords to service_role;;
