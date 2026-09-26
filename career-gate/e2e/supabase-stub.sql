-- Minimal stand-ins for objects a Supabase project already has.
create role anon; create role authenticated; create role service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
