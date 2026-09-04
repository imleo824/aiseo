begin;
create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
-- Runtime roles deliberately cannot use the extensions schema in production.
-- Grant pgTAP-only access inside this rolled-back test transaction so assertions
-- can continue to execute while SET ROLE is exercising the real RLS boundary.
grant usage on schema extensions to app_backend, app_worker;
grant execute on all functions in schema extensions to app_backend, app_worker;
select plan(50);

select is(
  (select count(*) from pg_class
   where oid = any(array[
     'public.profiles'::regclass, 'public.organizations'::regclass,
     'public.organization_members'::regclass, 'public.sites'::regclass,
     'public.integration_connections'::regclass, 'public.knowledge_sources'::regclass,
     'public.data_snapshots'::regclass, 'public.keyword_scans'::regclass,
     'public.opportunities'::regclass, 'public.growth_programs'::regclass,
     'public.growth_runs'::regclass, 'public.growth_run_stages'::regclass,
     'public.job_runs'::regclass, 'public.content_drafts'::regclass,
     'public.draft_reviews'::regclass, 'public.publish_attempts'::regclass,
     'public.indexing_observations'::regclass, 'public.payment_packages'::regclass,
     'public.action_prices'::regclass, 'public.payment_intents'::regclass,
     'public.ledger_entries'::regclass, 'public.credit_holds'::regclass,
     'public.usage_records'::regclass, 'public.idempotency_keys'::regclass,
     'public.audit_events'::regclass, 'public.terms_acceptances'::regclass,
     'public.notifications'::regclass, 'public.worker_heartbeats'::regclass,
     'public.system_settings'::regclass,
     'public.growth_decisions'::regclass, 'public.growth_actions'::regclass,
     'public.growth_observations'::regclass
   ]) and relrowsecurity),
  32::bigint,
  'every business table has RLS enabled'
);

select ok(not has_table_privilege('anon', 'public.sites', 'select,insert,update,delete'), 'anon has no business-table privileges');
select ok(not has_table_privilege('authenticated', 'public.sites', 'select,insert,update,delete'), 'authenticated has no business-table privileges');
select ok(not (select rolbypassrls from pg_roles where rolname = 'app_backend'), 'Web role cannot bypass RLS');
select ok(not (select rolbypassrls from pg_roles where rolname = 'app_worker'), 'Worker role cannot bypass RLS');
select ok(not (select rolcanlogin from pg_roles where rolname = 'app_backend'), 'migration never stores or enables the Web login credential');
select ok(not (select rolcanlogin from pg_roles where rolname = 'app_worker'), 'migration never stores or enables the Worker login credential');
select ok(not has_schema_privilege('anon', 'public', 'usage'), 'anon cannot access the business schema');
select ok(not has_schema_privilege('authenticated', 'public', 'usage'), 'authenticated cannot access the business schema');
select ok(has_schema_privilege('service_role', 'public', 'usage'), 'service role has schema usage required for the single erasure RPC');
select ok(not has_table_privilege('service_role', 'public.sites', 'select,insert,update,delete'), 'Auth service role has no business-table privileges');
select ok(has_function_privilege('app_backend', 'private.is_active_auth_session(uuid)', 'execute'), 'Web may validate a sensitive Auth session');
select ok(not has_function_privilege('anon', 'private.is_active_auth_session(uuid)', 'execute'), 'anon cannot inspect Auth sessions');
select ok(not has_table_privilege('app_backend', 'public.job_runs', 'update'), 'Web cannot forge job execution status');
select ok(not has_table_privilege('app_backend', 'public.payment_intents', 'delete'), 'Web cannot delete payment records');
select ok(not has_table_privilege('app_worker', 'public.profiles', 'update'), 'Worker cannot mutate profile authorization state');
select ok(not has_table_privilege('app_worker', 'public.payment_intents', 'insert'), 'Worker cannot manufacture payment intents');
select ok(not has_table_privilege('anon', 'public.growth_programs', 'select,insert,update,delete'), 'anon cannot access growth programs');
select ok(has_table_privilege('app_backend', 'public.growth_programs', 'select,insert,update') and not has_table_privilege('app_backend', 'public.growth_programs', 'delete'), 'Web may create, pause and resume growth programs without deleting history');
select ok(has_table_privilege('app_backend', 'public.growth_run_stages', 'select,insert') and not has_table_privilege('app_backend', 'public.growth_run_stages', 'update,delete'), 'Web may create initial stage records but cannot forge progress');
select ok(not has_table_privilege('app_backend', 'public.growth_decisions', 'insert'), 'Web cannot manufacture growth decisions');
select ok(not has_table_privilege('app_backend', 'public.growth_actions', 'insert'), 'Web cannot manufacture growth actions');
select ok(not has_table_privilege('app_backend', 'public.growth_observations', 'insert'), 'Web cannot manufacture growth observations');
select ok(has_table_privilege('app_worker', 'public.growth_observations', 'select,insert,update'), 'Worker owns the evidence lifecycle without bypassing RLS');
select ok(not has_table_privilege('app_worker', 'public.growth_observations', 'delete'), 'Worker cannot erase growth evidence');
select ok(to_regclass('public.execution_runs') is null and to_regclass('public.growth_cycles') is null and to_regclass('public.automation_tasks') is null, 'legacy duplicate engines are absent');
select ok(has_function_privilege('service_role', 'public.claim_due_account_erasures(integer)', 'execute'), 'isolated Edge Function can claim due account erasures');
select ok(not has_function_privilege('app_backend', 'public.claim_due_account_erasures(integer)', 'execute') and not has_function_privilege('app_worker', 'public.claim_due_account_erasures(integer)', 'execute'), 'application services cannot invoke delayed erasure');
select ok(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and confrelid = 'auth.users'::regclass
      and contype = 'f'
  ),
  'application profiles are not coupled to the Supabase-managed Auth schema by a foreign key'
);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'owner-a@example.test', crypt('StrongPassword1', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'owner-b@example.test', crypt('StrongPassword1', gen_salt('bf')), now(), now(), now());

select is((select count(*) from public.profiles where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2')), 2::bigint, 'Auth lifecycle creates matching profiles');

create temporary table rls_context (label text primary key, organization_id uuid not null);
create temporary table rls_results (label text primary key, affected bigint not null);
insert into rls_context
select 'a', organization_id from public.organization_members where profile_id = '00000000-0000-0000-0000-0000000000a1';
insert into rls_context
select 'b', organization_id from public.organization_members where profile_id = '00000000-0000-0000-0000-0000000000b2';
grant select on rls_context to app_backend, app_worker;
grant select, insert on rls_results to app_backend;

select is((select credit_balance_micros from public.organizations where id = (select organization_id from rls_context where label = 'a')), 0::bigint, 'new organization starts with zero credits');

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'a'), true);
set local role app_backend;
insert into public.sites (id, organization_id, domain, name, updated_at)
values ('00000000-0000-0000-0000-0000000000a3', (select organization_id from rls_context where label = 'a'), 'org-a.example.test', 'Org A site', now());
select is((select count(*) from public.sites), 1::bigint, 'owner can select own organization rows');
insert into public.growth_programs (id, organization_id, site_id, mode, input_type, input_value, input_fingerprint)
values ('00000000-0000-0000-0000-0000000000a4', (select organization_id from rls_context where label = 'a'), '00000000-0000-0000-0000-0000000000a3', 'ONCE', 'KEYWORD', 'WordPress SEO', 'rls-owner-program');
select is((select count(*) from public.growth_programs), 1::bigint, 'owner can create and select own growth program');
insert into public.growth_runs (id, organization_id, site_id, program_id, trigger, occurrence_key)
values ('00000000-0000-0000-0000-0000000000a5', (select organization_id from rls_context where label = 'a'), '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4', 'USER', 'rls-owner-run');
insert into public.growth_run_stages (organization_id, site_id, run_id, stage)
values ((select organization_id from rls_context where label = 'a'), '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a5', 'UNDERSTAND');
select ok((select count(*) from public.growth_runs) = 1 and (select count(*) from public.growth_run_stages) = 1, 'owner can create a run with durable stages');
reset role;

insert into public.sites (id, organization_id, domain, name, updated_at)
values ('00000000-0000-0000-0000-0000000000b3', (select organization_id from rls_context where label = 'b'), 'org-b.example.test', 'Org B site', now());
set local role app_worker;
select throws_like(
  format('insert into public.growth_programs (organization_id, site_id, mode, input_type, input_value, input_fingerprint) values (%L, %L, %L, %L, %L, %L)', (select organization_id from rls_context where label = 'a'), '00000000-0000-0000-0000-0000000000b3', 'ONCE', 'KEYWORD', 'cross tenant', 'cross-tenant-integrity'),
  '%site does not belong to organization%',
  'database rejects a cross-tenant site reference even for the Worker'
);
reset role;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated', 'unverified@example.test', crypt('StrongPassword1', gen_salt('bf')), now(), now());
select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000c3', true);
set local role app_backend;
select throws_like(
  $$select private.bootstrap_organization('Unverified Organization')$$,
  '%verified email is required%',
  'database bootstrap rejects an unverified Auth email'
);
reset role;

delete from auth.users where id = '00000000-0000-0000-0000-0000000000c3';
select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
  0::bigint,
  'Auth deletion removes the matching application profile through the lifecycle trigger'
);

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000b2', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'b'), true);
set local role app_backend;
select is(
  (select count(*) from public.sites where organization_id = (select organization_id from rls_context where label = 'a')),
  0::bigint,
  'cross-organization SELECT is denied while the user retains access to their own site'
);
select is((select count(*) from public.growth_programs), 0::bigint, 'cross-organization growth-program SELECT is denied');
select is((select count(*) from public.growth_runs), 0::bigint, 'cross-organization growth-run SELECT is denied');
select throws_like(
  format('insert into public.sites (organization_id, domain, name, updated_at) values (%L, %L, %L, now())', (select organization_id from rls_context where label = 'a'), 'cross.example.test', 'Cross org'),
  '%row-level security%',
  'cross-organization INSERT is denied'
);
reset role;

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'a'), true);
set local role app_backend;
insert into public.organization_members (organization_id, profile_id, role)
values ((select organization_id from rls_context where label = 'a'), '00000000-0000-0000-0000-0000000000b2', 'VIEWER');
reset role;

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000b2', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'a'), true);
set local role app_backend;
select is((select count(*) from public.sites), 1::bigint, 'viewer can SELECT organization rows');
select is((select count(*) from public.growth_runs), 1::bigint, 'viewer can SELECT organization growth runs');
select throws_like(
  format('insert into public.sites (organization_id, domain, name, updated_at) values (%L, %L, %L, now())', (select organization_id from rls_context where label = 'a'), 'viewer-write.example.test', 'Viewer write'),
  '%row-level security%',
  'viewer cannot INSERT organization rows'
);
with changed as (update public.sites set name = 'viewer changed' returning id)
insert into rls_results select 'viewer_site_update', count(*) from changed;
with changed as (update public.growth_programs set status = 'PAUSED' returning id)
insert into rls_results select 'viewer_program_update', count(*) from changed;
with changed as (update public.growth_runs set status = 'CANCELLED' returning id)
insert into rls_results select 'viewer_run_update', count(*) from changed;
reset role;
select is((select affected from rls_results where label = 'viewer_site_update'), 0::bigint, 'viewer cannot UPDATE organization rows');
select is((select affected from rls_results where label = 'viewer_program_update'), 0::bigint, 'viewer cannot UPDATE growth programs');
select is((select affected from rls_results where label = 'viewer_run_update'), 0::bigint, 'viewer cannot UPDATE growth runs');

update public.organizations set credit_balance_micros = 1000000 where id = (select organization_id from rls_context where label = 'a');
insert into public.ledger_entries (organization_id, type, amount_micros, balance_after_micros, reason, idempotency_key)
values ((select organization_id from rls_context where label = 'a'), 'ADJUSTMENT', 1000000, 1000000, 'RLS test adjustment', 'rls-test-ledger');
select throws_like($$update public.ledger_entries set reason = 'mutated' where idempotency_key = 'rls-test-ledger'$$, '%append-only%', 'ledger UPDATE is rejected');
select throws_like($$delete from public.ledger_entries where idempotency_key = 'rls-test-ledger'$$, '%append-only%', 'ledger DELETE is rejected');
select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000b2', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'b'), true);
set local role app_backend;
select throws_like(
  $$update public.profiles set platform_role = 'PLATFORM_ADMIN' where id = '00000000-0000-0000-0000-0000000000b2'$$,
  '%permission denied%',
  'user cannot self-promote to platform administrator'
);
reset role;

select * from finish();
rollback;
