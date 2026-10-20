-- =============================================================================
-- Kiosztott munkalap törlése: az érintetlen feladatok törlődnek, a munka marad
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
select import_tasks('[{"title":"A","body_md":"x","topic_slug":"egyenletek","difficulty":1},
                      {"title":"B","body_md":"y","topic_slug":"egyenletek","difficulty":1}]'::jsonb);
with w as (insert into worksheets (title) values ('Törlendő') returning id) insert into ids select 'ws', id from w;
select add_worksheet_item((select v from ids where k = 'ws'), id) from tasks where title in ('A', 'B');
insert into ids values ('as', assign_worksheet((select v from ids where k = 'ws'), '2026-10-12',
  array['00000000-0000-0000-0000-0000000000a1']::uuid[]));
with w as (insert into worksheets (title) values ('Üres kiosztás') returning id) insert into ids select 'ws2', id from w;
select add_worksheet_item((select v from ids where k = 'ws2'), id) from tasks where title = 'A';
select assign_worksheet((select v from ids where k = 'ws2'), '2026-10-12', array['00000000-0000-0000-0000-0000000000a1']::uuid[]);
reset role;
update student_tasks st set status = 'submitted' from tasks t
 where t.id = st.task_id and t.title = 'A' and st.assignment_id = (select v from ids where k = 'as');
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');

select _t((select delete_worksheet((select v from ids where k = 'ws'))) = '{"removed": 1, "kept": 1}'::jsonb,
          'törlés: 1 érintetlen feladat törölve, 1 beadott megmarad');
select _t(not exists (select 1 from worksheets where id = (select v from ids where k = 'ws')), 'a munkalap törölve');
select _t((select worksheet_id is null and worksheet_title = 'Törlendő' from assignments where id = (select v from ids where k = 'as')),
          'a munkát tartalmazó kiosztás megmarad, a munkalap címével');
select _t((select delete_worksheet((select v from ids where k = 'ws2')) ->> 'kept')::int = 0, 'üres kiosztás: semmi nem marad');
select _t((select count(*) from assignments) = 1, 'érintetlen kiosztás a munkalappal együtt eltűnik');

select _login('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform delete_worksheet(gen_random_uuid());
  raise exception 'FAIL: tanuló törölhetett';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem törölhet munkalapot';
end $$;
reset role;
rollback;
