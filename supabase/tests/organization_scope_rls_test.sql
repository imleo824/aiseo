begin;
select plan(22);

select ok((select relrowsecurity from pg_class where oid = 'public.organizations'::regclass), 'organizations has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_members'::regclass), 'organization_members has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.sites'::regclass), 'sites has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.integration_connections'::regclass), 'integration_connections has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.data_snapshots'::regclass), 'data_snapshots has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.job_runs'::regclass), 'job_runs has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.payment_intents'::regclass), 'payment_intents has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.ledger_entries'::regclass), 'ledger_entries has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.credit_holds'::regclass), 'credit_holds has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.content_drafts'::regclass), 'content_drafts has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.idempotency_keys'::regclass), 'idempotency_keys has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'audit_events has RLS enabled');

select ok(not has_table_privilege('anon', 'public.sites', 'select,insert,update,delete'), 'anon has no sites privileges');
select ok(not has_table_privilege('authenticated', 'public.sites', 'select,insert,update,delete'), 'authenticated has no sites privileges');
select ok(not has_table_privilege('anon', 'public.payment_intents', 'select,insert,update,delete'), 'anon has no payment privileges');
select ok(not has_table_privilege('authenticated', 'public.ledger_entries', 'select,insert,update,delete'), 'authenticated has no ledger privileges');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sites' and policyname = 'sites_scope'), 'sites scope policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_intents' and policyname = 'payment_intents_scope'), 'payment intent scope policy exists');

-- Exercise the actual policy using the Supabase authenticated role. These
-- temporary grants exist only inside this pgTAP transaction; production still
-- grants no direct Data API access to business tables.
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', 'RLS test organization A'),
  ('00000000-0000-0000-0000-0000000000b2', 'RLS test organization B');
insert into public.sites (id, organization_id, domain, name) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1', 'org-a.example.test', 'Org A site'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b2', 'org-b.example.test', 'Org B site');
grant usage on schema private to authenticated;
grant select, insert, update on public.sites to authenticated;

select set_config('app.organization_id', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
select is((select count(*) from public.sites), 1::bigint, 'RLS only returns organization A rows');
select is((with changed as (update public.sites set name = 'unexpected' where id = '00000000-0000-0000-0000-0000000000b4' returning id) select count(*) from changed), 0::bigint, 'RLS prevents organization A from updating organization B rows');
reset role;

select set_config('app.organization_id', '00000000-0000-0000-0000-0000000000b2', true);
set local role authenticated;
select is((select count(*) from public.sites), 1::bigint, 'RLS context switches to organization B without exposing organization A rows');
select throws_like(
  $$insert into public.sites (organization_id, domain, name) values ('00000000-0000-0000-0000-0000000000a1', 'cross-org.example.test', 'Cross organization')$$,
  'new row violates row-level security policy',
  'RLS rejects a cross-organization insert'
);
reset role;

select * from finish();
rollback;
