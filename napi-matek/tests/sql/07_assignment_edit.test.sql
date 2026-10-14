-- =============================================================================
-- Kiosztás javítása: visszavonás (csak érintetlen feladatok), áthelyezés, hozzáadás
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 's-b@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 's-c@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
select create_student('00000000-0000-0000-0000-0000000000a2', 'Bence');
select create_student('00000000-0000-0000-0000-0000000000a3', 'Csenge');
with w as (insert into worksheets (title) values ('Hibás') returning id) insert into ids select 'ws', id from w;
select add_worksheet_item((select v from ids where k = 'ws'), id) from (select id from tasks order by title limit 3) t;
insert into ids values ('as', assign_worksheet((select v from ids where k = 'ws'), '2026-10-12',
  array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2']::uuid[]));
select _t((select count(*) from student_tasks) = 6, 'kiindulás: 2 tanuló × 3 feladat');

-- Anna egyik feladata már beadva, egy másiknál kérdést írt.
reset role;
update student_tasks set status = 'submitted'
 where id = (select id from student_tasks where student_id = '00000000-0000-0000-0000-0000000000a1' order by position limit 1);
insert into messages (student_task_id, author_id, body_md)
select id, '00000000-0000-0000-0000-0000000000a1', 'kérdés'
  from student_tasks where student_id = '00000000-0000-0000-0000-0000000000a1' order by position offset 1 limit 1;
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');

-- Áthelyezés: az érintetlenek új dátumot kapnak, a beadott marad.
select _t(move_assignment((select v from ids where k = 'as'), '2026-10-19') = 5,
          'áthelyezés: 5 el nem kezdett feladat új dátumot kapott');
select _t((select min(scheduled_date) = '2026-10-19' from student_tasks where status = 'not_started'),
          'az el nem kezdett feladatok az új kezdőnaptól indulnak');
select _t((select scheduled_date = '2026-10-12' from student_tasks where status = 'submitted'),
          'a beadott feladat dátuma nem változott');

-- Tanuló hozzáadása; aki már benne van, kimarad.
select _t(add_students_to_assignment((select v from ids where k = 'as'),
          array['00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1']::uuid[]) = 3,
          'hozzáadás: Csenge 3 feladatot kapott, Anna nem duplikálódott');
select _t((select min(scheduled_date) = '2026-10-19' from student_tasks
            where student_id = '00000000-0000-0000-0000-0000000000a3'),
          'a hozzáadott tanuló a kiosztás (új) kezdőnapjától kapja a feladatokat');

-- Egy feladat eltávolítása.
select remove_student_task((select id from student_tasks where student_id = '00000000-0000-0000-0000-0000000000a3' limit 1));
select _t((select count(*) from student_tasks where student_id = '00000000-0000-0000-0000-0000000000a3') = 2,
          'egy érintetlen feladat eltávolítható');
do $$ begin
  perform remove_student_task((select id from student_tasks where status = 'submitted'));
  raise exception 'FAIL: beadott feladat eltávolítható';
exception when raise_exception then
  if sqlerrm <> 'task_in_use' then raise; end if;
  raise notice 'ok  - beadott feladat nem távolítható el';
end $$;

-- Visszavonás egy tanulónál, majd az egészre.
select _t((revoke_assignment((select v from ids where k = 'as'), '00000000-0000-0000-0000-0000000000a2') ->> 'removed')::int = 3,
          'visszavonás Bencénél: mind a 3 feladata törölve');
select _t((select revoke_assignment((select v from ids where k = 'as')))
          = '{"removed": 3, "kept": 2, "assignment_deleted": false}'::jsonb,
          'teljes visszavonás: az érintetlenek törölve, a beadott és az üzenetes megmarad');
select _t(exists (select 1 from assignments where id = (select v from ids where k = 'as')),
          'a kiosztás megmarad, amíg van benne megkezdett feladat');
reset role;

-- Ha minden érintetlen, a kiosztás maga is törlődik.
delete from messages;
update student_tasks set status = 'not_started';
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select _t((revoke_assignment((select v from ids where k = 'as')) ->> 'assignment_deleted')::boolean,
          'üres kiosztás teljesen törlődik');

-- Tanuló nem vonhat vissza.
select _login('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform revoke_assignment(gen_random_uuid());
  raise exception 'FAIL: tanuló visszavonhatott';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem vonhat vissza kiosztást';
end $$;
reset role;

rollback;
