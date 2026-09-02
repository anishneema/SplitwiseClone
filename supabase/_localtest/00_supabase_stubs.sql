-- Minimal stand-ins for the Supabase-managed objects the migration depends on,
-- so 20260830000000_init.sql can be syntax/semantics checked in a plain Postgres.
create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Test harness sets current_setting('test.uid') to impersonate a user.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

create publication supabase_realtime;

-- Supabase grants these by default on the public schema.
alter default privileges in schema public grant all on tables to anon, authenticated;

-- Supabase grants these to the client roles; without them RLS policies and
-- non-definer triggers that call auth.uid() fail with "permission denied".
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on auth.users to authenticated;
