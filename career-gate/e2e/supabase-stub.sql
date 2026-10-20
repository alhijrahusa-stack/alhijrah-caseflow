-- Minimal stand-ins for objects every Supabase project already has, so the
-- migrations can be validated on plain PostgreSQL. auth.uid() matches
-- Supabase's definition (reads request.jwt.claims).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
-- Supabase grants service_role everything on new public tables by default; a
-- migration that means less must revoke it.
alter default privileges in schema public grant all on tables to service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create publication supabase_realtime;
