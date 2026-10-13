-- =============================================================================
-- Minimális Supabase-környezet sima PostgreSQL-hez (CI és helyi teszt Docker nélkül).
-- CSAK teszthez! Éles Supabase-projektben ezek az objektumok már léteznek.
--
-- Utánozza: a szerepköröket, az auth.uid()/auth.jwt() függvényeket (a PostgREST
-- request.jwt.claims beállításából olvasnak), az auth.users/auth.sessions és a
-- storage táblákat, valamint az `extensions` sémát.
-- =============================================================================

-- A szerepkörök klaszterszintűek, egy korábbi futásból megmaradhattak.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls; end if;
end $$;

create schema extensions;
create schema auth;
create schema storage;

create table auth.users (
  id    uuid primary key,
  email text
);

create table auth.sessions (
  id      uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);

create function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create table storage.buckets (
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
