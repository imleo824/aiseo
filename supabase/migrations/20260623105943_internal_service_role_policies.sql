do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_sites' and policyname = 'tenant_sites_service_role_all') then
    create policy tenant_sites_service_role_all on public.tenant_sites
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_site_credentials' and policyname = 'tenant_site_credentials_service_role_all') then
    create policy tenant_site_credentials_service_role_all on public.tenant_site_credentials
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workbench_runs' and policyname = 'workbench_runs_service_role_all') then
    create policy workbench_runs_service_role_all on public.workbench_runs
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workbench_run_steps' and policyname = 'workbench_run_steps_service_role_all') then
    create policy workbench_run_steps_service_role_all on public.workbench_run_steps
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workbench_schedules' and policyname = 'workbench_schedules_service_role_all') then
    create policy workbench_schedules_service_role_all on public.workbench_schedules
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'keywords' and policyname = 'keywords_service_role_all') then
    create policy keywords_service_role_all on public.keywords
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_articles' and policyname = 'tenant_articles_service_role_all') then
    create policy tenant_articles_service_role_all on public.tenant_articles
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_article_publish_logs' and policyname = 'tenant_article_publish_logs_service_role_all') then
    create policy tenant_article_publish_logs_service_role_all on public.tenant_article_publish_logs
      for all to service_role using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_leads' and policyname = 'tenant_leads_service_role_all') then
    create policy tenant_leads_service_role_all on public.tenant_leads
      for all to service_role using (true) with check (true);
  end if;
end $$;

create index if not exists tenant_article_publish_logs_site_created_idx
  on public.tenant_article_publish_logs (site_id, created_at desc);;
