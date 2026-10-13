-- A Supabase alapértelmezett táblajogosultságai (default privileges) utánzása:
-- a szerepkörök táblaszinten mindent megkapnak, a tényleges korlátozást az RLS adja.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

-- Tesztsegéd: egy állítás ellenőrzése; hiba esetén a futás megáll.
create or replace function public._t(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'ok  - %', label;
end $$;
grant execute on function public._t(boolean, text) to anon, authenticated, service_role;

-- Tesztsegéd: „bejelentkezés” egy felhasználóként (PostgREST-szerű JWT claimek).
create or replace function public._login(p_sub uuid, p_session uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'session_id', p_session, 'role', 'authenticated')::text,
    false);
end $$;
grant execute on function public._login(uuid, uuid) to anon, authenticated, service_role;
