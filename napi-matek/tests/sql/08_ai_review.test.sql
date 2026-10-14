-- =============================================================================
-- Helyes válasz (teszt) és AI-javaslatok: csak a tanár látja
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 's-a@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000b0', 'teacher');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000b0');
select create_student('00000000-0000-0000-0000-0000000000b1', 'Anna');

-- Import: a helyes betű elmentődik, kisbetűt is elfogad; hibás betűre hiba.
select _t(import_tasks(jsonb_build_array(
  jsonb_build_object('title', 'Teszt 1', 'body_md', 'Mennyi? (A) 1 (B) 2', 'topic_slug',
    (select slug from topics order by id limit 1), 'difficulty', 2, 'task_type', 'teszt',
    'requires_image', false, 'correct_choice', 'b'),
  jsonb_build_object('title', 'Teszt 2', 'body_md', 'Melyik? (A) x (B) y', 'topic_slug',
    (select slug from topics order by id limit 1), 'difficulty', 2, 'task_type', 'teszt',
    'requires_image', false, 'solution_md', 'Mert.'))) = 2, 'import: 2 tesztfeladat');
select _t((select correct_choice from task_solutions s join tasks t on t.id = s.task_id where t.title = 'Teszt 1') = 'B',
          'a helyes betű nagybetűsítve elmentve, útmutató nélkül is');
select _t((select correct_choice is null from task_solutions s join tasks t on t.id = s.task_id where t.title = 'Teszt 2'),
          'helyes betű nélkül is importálható');
do $$ begin
  perform import_tasks(jsonb_build_array(jsonb_build_object('title', 'Rossz', 'body_md', 'x',
    'topic_slug', (select slug from topics order by id limit 1), 'difficulty', 1, 'correct_choice', 'Q')));
  raise exception 'FAIL: hibás betű importálható';
exception when raise_exception then
  if sqlerrm not like 'invalid_choice%' then raise; end if;
  raise notice 'ok  - hibás helyes-válasz betű elutasítva';
end $$;

-- Kiosztás és beadás, majd AI-javaslat mentése tanárként.
with w as (insert into worksheets (title) values ('AI') returning id) insert into ids select 'ws', id from w;
select add_worksheet_item((select v from ids where k = 'ws'), (select id from tasks where title = 'Teszt 1'));
select assign_worksheet((select v from ids where k = 'ws'), '2026-10-12',
  array['00000000-0000-0000-0000-0000000000b1']::uuid[]);
insert into ids select 'st', id from student_tasks limit 1;
reset role;
with s as (insert into submissions (student_task_id, version, submitted_at, choice, answer_text)
           values ((select v from ids where k = 'st'), 1, now(), 'C', 'mert') returning id)
insert into ids select 'sub', id from s;
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000b0');

insert into ai_reviews (student_task_id, submission_id, model, result)
values ((select v from ids where k = 'st'), (select v from ids where k = 'sub'), 'teszt-modell',
        '{"verdict": "needs_revision", "feedback_md": "Nézd meg újra."}');
select _t((select created_by = '00000000-0000-0000-0000-0000000000b0' from ai_reviews),
          'a javaslat a tanárhoz kötve mentődik');

-- A tanuló sem a javaslatot, sem a helyes választ nem látja.
select _login('00000000-0000-0000-0000-0000000000b1');
select _t((select count(*) from ai_reviews) = 0, 'tanuló nem látja az AI-javaslatot');
select _t((select count(*) from task_solutions) = 0, 'tanuló nem látja a helyes választ');
do $$ begin
  insert into ai_reviews (student_task_id, submission_id, model, result)
  values ((select v from ids where k = 'st'), (select v from ids where k = 'sub'), 'x', '{}');
  raise exception 'FAIL: tanuló írhatott javaslatot';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem írhat AI-javaslatot';
end $$;
reset role;

-- Új beadás törlésekor a javaslat is törlődik.
delete from submissions where id = (select v from ids where k = 'sub');
select _t((select count(*) from ai_reviews) = 0, 'a beadással együtt a javaslat is törlődik');

rollback;
