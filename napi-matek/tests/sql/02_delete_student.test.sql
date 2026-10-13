-- =============================================================================
-- Tanuló végleges törlése: csak letiltott tanuló, csak tanár, minden adat törlődik
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 's-b@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
select create_student('00000000-0000-0000-0000-0000000000a2', 'Bence');
reset role;

-- Anna kap egy kiosztott feladatot, beadást és üzenetet, hogy a kaszkádot is lássuk.
insert into tasks (id, title, body_md, topic_id, difficulty)
  values ('22222222-0000-0000-0000-000000000001', 'T', '$x$', 1, 2);
insert into worksheets (id, title) values ('33333333-0000-0000-0000-000000000001', 'W');
insert into assignments (id, worksheet_id, start_date)
  values ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '2026-10-12');
insert into student_tasks (id, assignment_id, student_id, task_id, position, scheduled_date, due_date)
  values ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', '22222222-0000-0000-0000-000000000001', 1,
          '2026-10-12', '2026-10-18');
insert into submissions (id, student_task_id, version)
  values ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 1);
insert into submission_images (submission_id, storage_path)
  values ('66666666-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1/55555555-0000-0000-0000-000000000001/x.jpg');
insert into messages (student_task_id, author_id, body_md) values
  ('55555555-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'kérdés'),
  ('55555555-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a0', 'válasz');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');

-- Aktív tanuló nem törölhető.
do $$ begin
  perform delete_student('00000000-0000-0000-0000-0000000000a1');
  raise exception 'FAIL: aktív tanuló törölhető volt';
exception when raise_exception then
  if sqlerrm <> 'student_not_disabled' then raise; end if;
  raise notice 'ok  - aktív (nem letiltott) tanuló nem törölhető';
end $$;

select set_student_disabled('00000000-0000-0000-0000-0000000000a1', true);
reset role;

-- Tanuló nem törölhet (még letiltott társat sem).
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a2');
do $$ begin
  perform delete_student('00000000-0000-0000-0000-0000000000a1');
  raise exception 'FAIL: tanuló törölhetett';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem törölhet tanulót (42501)';
end $$;

-- Tanár törli a letiltott tanulót.
select _login('00000000-0000-0000-0000-0000000000a0');
select delete_student('00000000-0000-0000-0000-0000000000a1');
reset role;

select _t(not exists (select 1 from students where id = '00000000-0000-0000-0000-0000000000a1'),
          'a tanuló profilja törölve');
select _t(not exists (select 1 from app_users where user_id = '00000000-0000-0000-0000-0000000000a1'),
          'a szerepkör-sor törölve');
select _t(not exists (select 1 from student_credentials where student_id = '00000000-0000-0000-0000-0000000000a1'),
          'a kódhash törölve');
select _t(not exists (select 1 from student_tasks where student_id = '00000000-0000-0000-0000-0000000000a1'),
          'a kiosztott feladatai törölve');
select _t((select count(*) from submissions) = 0 and (select count(*) from submission_images) = 0,
          'a beadásai és képhivatkozásai törölve');
select _t((select count(*) from messages) = 0, 'a feladataihoz tartozó üzenetszál törölve');
select _t(exists (select 1 from students where id = '00000000-0000-0000-0000-0000000000a2'),
          'a másik tanuló érintetlen');
select _t(exists (select 1 from app_users where user_id = '00000000-0000-0000-0000-0000000000a0'),
          'a tanár érintetlen');
select _t(exists (select 1 from tasks where id = '22222222-0000-0000-0000-000000000001'),
          'a feladatbank érintetlen');

-- Tanár nem „törölhető tanulóként”: a függvény csak tanulói sort töröl.
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
do $$ begin
  perform delete_student('00000000-0000-0000-0000-0000000000a0');
  raise exception 'FAIL: nem tanulói azonosítóval is futott';
exception when no_data_found then
  raise notice 'ok  - nem tanulói azonosítóra student_not_found';
end $$;
reset role;

rollback;
