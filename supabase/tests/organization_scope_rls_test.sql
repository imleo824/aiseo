begin;
select plan(29);

select is(
  (select count(*) from pg_class
   where oid = any(array[
     'public.profiles'::regclass, 'public.organizations'::regclass,
     'public.organization_members'::regclass, 'public.sites'::regclass,
     'public.integration_connections'::regclass, 'public.knowledge_sources'::regclass,
     'public.data_snapshots'::regclass, 'public.keyword_scans'::regclass,
     'public.opportunities'::regclass, 'public.automation_tasks'::regclass,
     'public.job_runs'::regclass, 'public.content_drafts'::regclass,
     'public.draft_reviews'::regclass, 'public.publish_attempts'::regclass,
     'public.indexing_observations'::regclass, 'public.payment_packages'::regclass,
     'public.action_prices'::regclass, 'public.payment_intents'::regclass,
     'public.ledger_entries'::regclass, 'public.credit_holds'::regclass,
     'public.usage_records'::regclass, 'public.idempotency_keys'::regclass,
     'public.audit_events'::regclass, 'public.terms_acceptances'::regclass,
     'public.notifications'::regclass, 'public.worker_heartbeats'::regclass,
     'public.system_settings'::regclass
   ]) and relrowsecurity and relforcerowsecurity),
  27::bigint,
  'every business table has RLS enabled and forced'
);

select ok(not has_table_privilege('anon', 'public.sites', 'select,insert,update,delete'), 'anon has no business-table privileges');
select ok(not has_table_privilege('authenticated', 'public.sites', 'select,insert,update,delete'), 'authenticated has no business-table privileges');
select ok(not (select rolbypassrls from pg_roles where rolname = 'app_backend'), 'Web role cannot bypass RLS');
select ok(not (select rolbypassrls from pg_roles where rolname = 'app_worker'), 'Worker role cannot bypass RLS');
select ok(not (select rolcanlogin from pg_roles where rolname = 'app_backend'), 'migration never stores or enables the Web login credential');
select ok(not (select rolcanlogin from pg_roles where rolname = 'app_worker'), 'migration never stores or enables the Worker login credential');
select ok(not has_schema_privilege('anon', 'public', 'usage'), 'anon cannot access the business schema');
select ok(not has_schema_privilege('authenticated', 'public', 'usage'), 'authenticated cannot access the business schema');
select ok(not has_schema_privilege('service_role', 'public', 'usage'), 'Auth service role cannot access the business schema through Data API');
select ok(not has_table_privilege('service_role', 'public.sites', 'select,insert,update,delete'), 'Auth service role has no business-table privileges');
select ok(has_function_privilege('app_backend', 'private.is_active_auth_session(uuid)', 'execute'), 'Web may validate a sensitive Auth session');
select ok(not has_function_privilege('anon', 'private.is_active_auth_session(uuid)', 'execute'), 'anon cannot inspect Auth sessions');
select ok(not has_table_privilege('app_backend', 'public.job_runs', 'update'), 'Web cannot forge job execution status');
select ok(not has_table_privilege('app_backend', 'public.payment_intents', 'delete'), 'Web cannot delete payment records');
select ok(not has_table_privilege('app_worker', 'public.profiles', 'update'), 'Worker cannot mutate profile authorization state');
select ok(not has_table_privilege('app_worker', 'public.payment_intents', 'insert'), 'Worker cannot manufacture payment intents');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'owner-a@example.test', crypt('StrongPassword1', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated', 'owner-b@example.test', crypt('StrongPassword1', gen_salt('bf')), now(), now(), now());

select is((select count(*) from public.profiles where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2')), 2::bigint, 'Auth lifecycle creates matching profiles');

create temporary table rls_context (label text primary key, organization_id uuid not null);
select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000a1', true);
insert into rls_context values ('a', private.bootstrap_organization('Organization A'));
select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000b2', true);
insert into rls_context values ('b', private.bootstrap_organization('Organization B'));

select is((select credit_balance_micros from public.organizations where id = (select organization_id from rls_context where label = 'a')), 0::bigint, 'new organization starts with zero credits');

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'a'), true);
set local role app_backend;
insert into public.sites (id, organization_id, domain, name, updated_at)
values ('00000000-0000-0000-0000-0000000000a3', (select organization_id from rls_context where label = 'a'), 'org-a.example.test', 'Org A site', now());
select is((select count(*) from public.sites), 1::bigint, 'owner can select own organization rows');
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

select set_config('app.profile_id', '00000000-0000-0000-0000-0000000000b2', true);
select set_config('app.organization_id', (select organization_id::text from rls_context where label = 'b'), true);
set local role app_backend;
select is((select count(*) from public.sites), 0::bigint, 'cross-organization SELECT is denied');
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
select throws_like(
  format('insert into public.sites (organization_id, domain, name, updated_at) values (%L, %L, %L, now())', (select organization_id from rls_context where label = 'a'), 'viewer-write.example.test', 'Viewer write'),
  '%row-level security%',
  'viewer cannot INSERT organization rows'
);
select is((with changed as (update public.sites set name = 'viewer changed' returning id) select count(*) from changed), 0::bigint, 'viewer cannot UPDATE organization rows');
reset role;

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
