-- =============================================================================
-- 1. lépés: belépés, munkamenetek, tanulókezelés
--
-- Jogosultsági modell az RPC-knél
--   * „service” függvények: csak a szerver hívhatja a titkos (service role)
--     kulccsal. A belépési folyamat lépései ezek, mert anonim kérésből indulnak.
--   * „tanár” függvények: a tanár saját munkamenetével hívja őket; a függvény
--     maga ellenőrzi az is_teacher()-t (védelem mélységben: a szerver is ellenőriz).
--   * „tanuló” függvények: a current_student_id()-ra épülnek.
-- A Supabase alapból minden függvényre EXECUTE jogot ad az anon/authenticated
-- szerepköröknek, ezért a migráció végén ezt explicit módon szűkítjük.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Belső segédfüggvények
-- -----------------------------------------------------------------------------

-- 8 karakteres belépőkód a 32 elemű ábécéből (nincs 0/O, 1/I; kisbetű nincs, így
-- l sem). 32 = 2^5, ezért a véletlen bájt alsó 5 bitje torzítás nélkül indexel.
-- Kombinációk: 32^8 ≈ 1,1·10^12.
create or replace function public.generate_login_code() returns text
language plpgsql volatile
set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  end loop;
  return code;
end $$;

-- Egy tanuló összes munkamenetének visszavonása: a saját nyilvántartásunkban
-- és a Supabase Auth-ban is (így a refresh token sem használható tovább).
create or replace function public._revoke_all_student_sessions(p_student_id uuid) returns void
language plpgsql security definer
set search_path = public as $$
begin
  update student_sessions set revoked_at = now()
   where student_id = p_student_id and revoked_at is null;
  -- Ha a projekt jogosultságai nem engednék az auth séma írását, a hozzáférést
  -- akkor is elveszti a tanuló (current_student_id() a saját táblánkat nézi);
  -- ilyenkor csak a refresh token marad meg, amivel már semmit sem ér el.
  begin
    delete from auth.sessions where user_id = p_student_id;
  exception when insufficient_privilege then
    raise warning 'auth.sessions nem írható; a visszavonás csak az alkalmazás szintjén történt';
  end;
end $$;

-- Tanuló létrehozása egy már létező (szintetikus) auth userhez. Visszaadja a nyers
-- kódot – ez az egyetlen pillanat, amikor a kód olvasható formában létezik.
create or replace function public._create_student(p_user_id uuid, p_display_name text)
returns text
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_code text := generate_login_code();
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'auth_user_missing' using errcode = 'P0002';
  end if;

  insert into app_users (user_id, role) values (p_user_id, 'student');
  insert into students (id, display_name) values (p_user_id, btrim(p_display_name));
  insert into student_credentials (student_id, code_hash)
       values (p_user_id, crypt(v_code, gen_salt('bf', 10)));
  return v_code;
end $$;

-- -----------------------------------------------------------------------------
-- Service függvények (csak szerveroldalról, titkos kulccsal)
-- -----------------------------------------------------------------------------

-- Brute force elleni védelem. Fix, 15 perces ablakok; minden próbálkozás számít.
-- Korlátok: IP-nként 10, belépési nevenként 5 próbálkozás ablakonként. A névalapú
-- korlát az elosztott (sok IP-ről jövő) próbálkozást is megfogja.
create or replace function public.check_login_rate(p_ip text, p_name text)
returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  v_window timestamptz := date_bin('15 minutes', now(), timestamptz '2000-01-01');
  v_ip_attempts int;
  v_name_attempts int;
begin
  insert into login_attempts as la (bucket, window_start, attempts)
       values ('ip:' || coalesce(p_ip, 'unknown'), v_window, 1)
  on conflict (bucket, window_start) do update set attempts = la.attempts + 1
  returning attempts into v_ip_attempts;

  insert into login_attempts as la (bucket, window_start, attempts)
       values ('name:' || normalize_login_name(coalesce(p_name, '')), v_window, 1)
  on conflict (bucket, window_start) do update set attempts = la.attempts + 1
  returning attempts into v_name_attempts;

  -- Régi ablakok takarítása (olcsó, mert kevés sor van).
  delete from login_attempts where window_start < now() - interval '1 day';

  return v_ip_attempts <= 10 and v_name_attempts <= 5;
end $$;

-- Név + kód ellenőrzése. Ismeretlen névnél is lefuttat egy bcryptet, hogy a
-- válaszidőből ne lehessen kikövetkeztetni, létezik-e a név.
create or replace function public.verify_student_code(p_name text, p_code text)
returns table (student_id uuid, code_version int)
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_id uuid;
  v_hash text;
  v_version int;
  v_code text := normalize_login_code(p_code);
begin
  select s.id, c.code_hash, c.code_version
    into v_id, v_hash, v_version
    from students s
    join student_credentials c on c.student_id = s.id
   where s.login_key = normalize_login_name(p_name)
     and s.disabled_at is null;

  if v_id is null then
    perform crypt(v_code, gen_salt('bf', 10));  -- időzítés kiegyenlítése
    return;
  end if;

  if v_hash = crypt(v_code, v_hash) then
    student_id := v_id;
    code_version := v_version;
    return next;
  end if;
end $$;

-- Új eszközmunkamenet nyilvántartása (a Supabase JWT session_id-jához kötve).
create or replace function public.register_student_session(
  p_session_id uuid, p_student_id uuid, p_code_version int, p_user_agent text)
returns timestamptz
language plpgsql security definer
set search_path = public as $$
declare
  v_expires timestamptz := now() + interval '365 days';
begin
  insert into student_sessions (session_id, student_id, code_version, expires_at, user_agent)
  values (p_session_id, p_student_id, p_code_version, v_expires, left(p_user_agent, 300))
  on conflict (session_id) do update
     set expires_at = excluded.expires_at, revoked_at = null,
         code_version = excluded.code_version;
  return v_expires;
end $$;

-- Egyetlen munkamenet visszavonása (kilépés, illetve megújításkor a régi).
-- A student_id egyezését is megköveteli, így más munkamenete nem vonható vissza.
create or replace function public.revoke_student_session(p_session_id uuid, p_student_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  update student_sessions set revoked_at = now()
   where session_id = p_session_id and student_id = p_student_id and revoked_at is null;
  begin
    delete from auth.sessions where id = p_session_id and user_id = p_student_id;
  exception when insufficient_privilege then
    raise warning 'auth.sessions nem írható; a visszavonás csak az alkalmazás szintjén történt';
  end;
end $$;

-- Seed-szkripthez: tanuló létrehozása tanári munkamenet nélkül.
create or replace function public.service_create_student(p_user_id uuid, p_display_name text)
returns text
language sql security definer
set search_path = public as $$
  select _create_student(p_user_id, p_display_name)
$$;

-- -----------------------------------------------------------------------------
-- Tanár függvények
-- -----------------------------------------------------------------------------

create or replace function public._assert_teacher() returns void
language plpgsql stable security definer
set search_path = public as $$
begin
  if not is_teacher() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.create_student(p_user_id uuid, p_display_name text)
returns text
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  return _create_student(p_user_id, p_display_name);
end $$;

-- Új kód: a verziószám növelése azonnal érvényteleníti az összes meglévő
-- munkamenetet (current_student_id() a verzióegyezést is nézi).
create or replace function public.regenerate_student_code(p_student_id uuid)
returns text
language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_code text := generate_login_code();
begin
  perform _assert_teacher();
  update student_credentials
     set code_hash = crypt(v_code, gen_salt('bf', 10)),
         code_version = code_version + 1,
         rotated_at = now()
   where student_id = p_student_id;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  perform _revoke_all_student_sessions(p_student_id);
  return v_code;
end $$;

create or replace function public.set_student_disabled(p_student_id uuid, p_disabled boolean)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  update students
     set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end
   where id = p_student_id;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if p_disabled then
    perform _revoke_all_student_sessions(p_student_id);
  end if;
end $$;

create or replace function public.rename_student(p_student_id uuid, p_display_name text)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  update students set display_name = btrim(p_display_name) where id = p_student_id;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Bárki (bejelentkezett) által hívható lekérdezések
-- -----------------------------------------------------------------------------

-- A bejelentkezett felhasználó szerepköre (NULL, ha nincs vagy ismeretlen).
create or replace function public.my_role() returns public.user_role
language sql stable security definer
set search_path = public as $$
  select role from app_users where user_id = auth.uid()
$$;

-- A tanulói munkamenet állapota a felülethez: érvényes-e, mikor jár le.
-- A lejárati figyelmeztetés (utolsó 7 nap) és a kiléptetés ebből dolgozik.
create or replace function public.student_session_state()
returns table (valid boolean, expires_at timestamptz, display_name text)
language sql stable security definer
set search_path = public as $$
  select current_student_id() is not null, ss.expires_at, s.display_name
    from student_sessions ss
    join students s on s.id = ss.student_id
   where ss.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
     and ss.student_id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- Jogosultságok
-- -----------------------------------------------------------------------------

revoke execute on function
  public.generate_login_code(),
  public._revoke_all_student_sessions(uuid),
  public._create_student(uuid, text),
  public._assert_teacher(),
  public.check_login_rate(text, text),
  public.verify_student_code(text, text),
  public.register_student_session(uuid, uuid, int, text),
  public.revoke_student_session(uuid, uuid),
  public.service_create_student(uuid, text),
  public.create_student(uuid, text),
  public.regenerate_student_code(uuid),
  public.set_student_disabled(uuid, boolean),
  public.rename_student(uuid, text),
  public.my_role(),
  public.student_session_state()
from public, anon, authenticated;

grant execute on function
  public.check_login_rate(text, text),
  public.verify_student_code(text, text),
  public.register_student_session(uuid, uuid, int, text),
  public.revoke_student_session(uuid, uuid),
  public.service_create_student(uuid, text)
to service_role;

grant execute on function
  public.create_student(uuid, text),
  public.regenerate_student_code(uuid),
  public.set_student_disabled(uuid, boolean),
  public.rename_student(uuid, text),
  public.my_role(),
  public.student_session_state()
to authenticated;

-- Az RLS-ben használt segédfüggvények az authenticated szerepkörnek kellenek.
revoke execute on function public.is_teacher(), public.current_student_id() from public, anon;
grant  execute on function public.is_teacher(), public.current_student_id() to authenticated, service_role;
