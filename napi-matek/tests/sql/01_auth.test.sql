-- =============================================================================
-- 1. lépés tesztjei: kódgenerálás, belépés, rate limit, munkamenetek, RLS-izoláció
-- Futtatás: scripts/test-db.sh (minden tesztfájl friss adatbázison, tranzakcióban)
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

-- Szereplők ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 's-b@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 's-c@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

-- Kódgenerálás ---------------------------------------------------------------
select _t(
  (select bool_and(c ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$') and count(distinct c) = 500
     from (select generate_login_code() c from generate_series(1, 500)) x),
  '500 generált kód mind 8 karakteres, a tiltott karakterek (0,O,1,I,l) nélkül, és egyediek');

-- Tanuló létrehozása tanárként --------------------------------------------------
create temp table codes (who text primary key, code text);
grant all on codes to authenticated, service_role;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
insert into codes values
  ('anna',  create_student('00000000-0000-0000-0000-0000000000a1', 'Kiss Ánna')),
  ('bence', create_student('00000000-0000-0000-0000-0000000000a2', 'Nagy Bence'));
select _t((select count(*) from codes where code ~ '^[A-Z2-9]{8}$') = 2,
          'a tanár létrehoz két tanulót és megkapja a kódjukat');

-- Összetéveszthető név nem hozható létre (normalizált egyediség).
do $$ begin
  perform create_student('00000000-0000-0000-0000-0000000000a3', '  kiss   anna ');
  raise exception 'FAIL: duplikált név létrejött';
exception when unique_violation then
  raise notice 'ok  - „kiss anna” elutasítva, mert ütközik a „Kiss Ánna” névvel';
end $$;
reset role;

-- Nem tanár nem hozhat létre tanulót.
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform create_student('00000000-0000-0000-0000-0000000000a3', 'Harmadik');
  raise exception 'FAIL: tanuló létrehozott tanulót';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem hozhat létre tanulót (42501)';
end $$;
reset role;

-- Anonim kliens nem hívhatja a belépési service függvényeket.
set local role anon;
do $$ begin
  perform * from verify_student_code('Kiss Ánna', 'AAAAAAAA');
  raise exception 'FAIL: anon hívhatta a verify_student_code-ot';
exception when insufficient_privilege then
  raise notice 'ok  - anon nem hívhatja a verify_student_code-ot';
end $$;
reset role;

-- Kódellenőrzés (service role) --------------------------------------------------
set local role service_role;
select _t(
  (select student_id from verify_student_code('kiss anna',
     (select lower(substr(code,1,4)) || '-' || lower(substr(code,5)) from codes where who='anna')))
  = '00000000-0000-0000-0000-0000000000a1',
  'helyes kód elfogadva kisbetűvel, kötőjellel, ékezet nélküli névvel');
select _t(not exists (select 1 from verify_student_code('Kiss Ánna', 'ZZZZZZZZ')),
          'hibás kód elutasítva');
select _t(not exists (select 1 from verify_student_code('Nincs Ilyen',
            (select code from codes where who='anna'))),
          'ismeretlen név elutasítva');
select _t(not exists (select 1 from verify_student_code('Nagy Bence',
            (select code from codes where who='anna'))),
          'más tanuló kódja nem jó');

-- Rate limit ------------------------------------------------------------------
select _t((select bool_and(check_login_rate('9.9.9.9', 'cel' || g)) from generate_series(1, 10) g),
          'IP-nként 10 próbálkozás engedélyezett');
select _t(not check_login_rate('9.9.9.9', 'cel-11'), 'a 11. próbálkozás ugyanarról az IP-ről tiltva');
select _t((select bool_and(check_login_rate('10.0.0.' || g, 'Áldozat')) from generate_series(1, 5) g),
          'névenként 5 próbálkozás engedélyezett (különböző IP-kről)');
select _t(not check_login_rate('10.0.0.99', 'aldozat'),
          'a 6. próbálkozás ugyanarra a névre tiltva, más IP-ről és ékezet nélkül is');

-- Munkamenetek ----------------------------------------------------------------
-- (Az Auth munkameneteket a Supabase Auth hozza létre; itt szuperuserként szimuláljuk.)
reset role;
insert into auth.sessions (id, user_id) values
  ('11111111-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('11111111-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2'),
  ('11111111-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1');
set local role service_role;
select _t(register_student_session('11111111-0000-0000-0000-0000000000a1',
            '00000000-0000-0000-0000-0000000000a1', 1, 'teszt')
          between now() + interval '364 days' and now() + interval '366 days',
          'a munkamenet 365 napig érvényes');
select register_student_session('11111111-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a2', 1, 'teszt');
select register_student_session('11111111-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1', 1, 'második eszköz');
reset role;

-- RLS: tanuló csak magát látja -------------------------------------------------
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');
select _t(current_student_id() = '00000000-0000-0000-0000-0000000000a1', 'érvényes munkamenet → tanuló azonosítva');
select _t((select count(*) from students) = 1, 'a tanuló csak a saját students sorát látja');
select _t((select count(*) from student_credentials) = 0, 'a kódhash-táblából semmit sem lát');
select _t((select count(*) from login_attempts) = 0, 'a rate limit táblából semmit sem lát');
select _t((select count(*) from student_sessions) = 2, 'csak a saját két eszközét látja');
select _t((select my_role()) = 'student', 'my_role() = student');
select _t((select valid from student_session_state()), 'student_session_state(): érvényes');

-- Idegen session_id-vel (pl. ellopott JWT másik claimmel) semmit sem lát.
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a2');
select _t(current_student_id() is null, 'más tanuló munkamenet-azonosítójával nincs hozzáférés');
select _t((select count(*) from students) = 0, '… és egyetlen students sort sem lát');

-- Munkamenet nélkül (pl. régi JWT session_id nélkül) sincs hozzáférés.
select _login('00000000-0000-0000-0000-0000000000a1');
select _t((select count(*) from students) = 0, 'session_id nélkül nincs hozzáférés');
reset role;

-- Lejárt munkamenet -----------------------------------------------------------
update student_sessions set expires_at = now() - interval '1 second'
 where session_id = '11111111-0000-0000-0000-0000000000b1';
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000b1');
select _t(current_student_id() is null, 'lejárt munkamenettel nincs hozzáférés');
select _t((select not valid from student_session_state()), 'student_session_state(): lejárt → érvénytelen');
reset role;

-- Kód újragenerálása: minden eszköz kilép --------------------------------------
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
update codes set code = regenerate_student_code('00000000-0000-0000-0000-0000000000a1') where who = 'anna';
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');
select _t(current_student_id() is null, 'újragenerálás után a régi munkamenet érvénytelen');
reset role;
select _t(not exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000a1'),
          'újragenerálás után az Auth munkamenetek (refresh tokenek) is törölve');
set local role service_role;
select _t(exists (select 1 from verify_student_code('Kiss Ánna', (select code from codes where who='anna'))
                  where code_version = 2),
          'az új kód működik, kódverzió = 2');
reset role;

-- Letiltás --------------------------------------------------------------------
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select set_student_disabled('00000000-0000-0000-0000-0000000000a2', true);
reset role;
set local role service_role;
select _t(not exists (select 1 from verify_student_code('Nagy Bence', (select code from codes where who='bence'))),
          'letiltott tanuló nem léphet be');
reset role;
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-0000000000a2');
select _t(current_student_id() is null, 'letiltáskor a meglévő munkamenet is megszűnik');
select _login('00000000-0000-0000-0000-0000000000a0');
select set_student_disabled('00000000-0000-0000-0000-0000000000a2', false);
reset role;
set local role service_role;
select _t(exists (select 1 from verify_student_code('Nagy Bence', (select code from codes where who='bence'))),
          'visszaengedélyezés után a kód újra működik');
reset role;

-- Tanár mindent lát ------------------------------------------------------------
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select _t((select count(*) from students) = 2, 'a tanár minden tanulót lát');
select _t((select my_role()) = 'teacher', 'my_role() = teacher');
reset role;

rollback;
