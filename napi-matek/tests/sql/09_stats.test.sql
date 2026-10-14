-- =============================================================================
-- Statisztika-összesítők: napi, heti, témakörönkénti; ki mit lát
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000c2', 's-b@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000c0', 'teacher');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000c0');
select create_student('00000000-0000-0000-0000-0000000000c1', 'Anna');
select create_student('00000000-0000-0000-0000-0000000000c2', 'Bence');
select import_tasks(jsonb_build_array(
  jsonb_build_object('title', 'T1', 'body_md', '(A) 1 (B) 2', 'topic_slug', 'algebra', 'difficulty', 1,
                     'task_type', 'teszt', 'requires_image', false, 'correct_choice', 'B'),
  jsonb_build_object('title', 'T2', 'body_md', '(A) 1 (B) 2', 'topic_slug', 'algebra', 'difficulty', 1,
                     'task_type', 'teszt', 'requires_image', false, 'correct_choice', 'A'),
  jsonb_build_object('title', 'K1', 'body_md', 'x', 'topic_slug', 'kombinatorika', 'difficulty', 2)));
with w as (insert into worksheets (title) values ('Stat') returning id) insert into ids select 'ws', id from w;
select add_worksheet_item((select v from ids where k = 'ws'), id) from tasks where title in ('T1', 'T2', 'K1');
select assign_worksheet((select v from ids where k = 'ws'), '2026-09-28',
  array['00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c2']::uuid[]);
reset role;

-- Rögzített menetrend: T1 hétfő 09-28, T2 kedd 09-29, K1 szerda 09-30.
update student_tasks st set scheduled_date = case t.title when 'T1' then date '2026-09-28'
                                                          when 'T2' then date '2026-09-29'
                                                          else date '2026-09-30' end
  from tasks t where t.id = st.task_id;

-- Anna: T1 hétfőn este 23:30-kor (budapesti idő!) helyesen, T2 szombaton hibásan, K1 csütörtökön.
create function pg_temp.submit(p_student uuid, p_title text, p_at timestamptz, p_choice text) returns void
language sql as $$
  insert into submissions (student_task_id, version, submitted_at, choice)
  select st.id, 1, p_at, p_choice from student_tasks st join tasks t on t.id = st.task_id
   where st.student_id = p_student and t.title = p_title;
  update student_tasks st set first_submitted_at = p_at, status = 'submitted'
    from tasks t where t.id = st.task_id and st.student_id = p_student and t.title = p_title;
$$;
select pg_temp.submit('00000000-0000-0000-0000-0000000000c1', 'T1', '2026-09-28 21:30+00', 'B');
select pg_temp.submit('00000000-0000-0000-0000-0000000000c1', 'K1', '2026-10-01 10:00+00', null);
select pg_temp.submit('00000000-0000-0000-0000-0000000000c1', 'T2', '2026-10-03 09:00+00', 'B');
-- Bence: csak T1, vasárnap (a szombat után).
select pg_temp.submit('00000000-0000-0000-0000-0000000000c2', 'T1', '2026-10-04 09:00+00', 'A');

insert into auth.sessions (id, user_id) values ('11111111-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1');
set local role service_role;
select register_student_session('11111111-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 1, 't');
reset role;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000c0');

select _t((select scheduled = 1 and submitted = 1 from stats_daily('00000000-0000-0000-0000-0000000000c1')
            where day = '2026-09-28'), 'hétfő: 1 ütemezett, 1 beadás (23:30 budapesti idő még hétfő)');
select _t((select scheduled = 1 and submitted = 0 from stats_daily('00000000-0000-0000-0000-0000000000c1')
            where day = '2026-09-29'), 'kedd: ütemezett, de nem adott be');
select _t((select scheduled = 0 and submitted = 1 from stats_daily('00000000-0000-0000-0000-0000000000c1')
            where day = '2026-10-01'), 'csütörtök: nem volt ütemezve, mégis beadott');
select _t((select total = 3 and done_by_saturday = 3 from stats_weekly('00000000-0000-0000-0000-0000000000c1')),
          'Anna szombatig mindent beadott');
select _t((select total = 3 and done_by_saturday = 0 from stats_weekly('00000000-0000-0000-0000-0000000000c2')),
          'Bence vasárnapi beadása már nem számít a szombathoz');
select _t((select assigned = 2 and submitted = 2 and test_checked = 2 and test_correct = 1
             from stats_topics('00000000-0000-0000-0000-0000000000c1') where topic_name like 'Algebra%'),
          'témakör: 2 teszt, 1 helyes (a tanár látja)');
select _t((select count(distinct student_id) = 2 from stats_daily()), 'a tanár mindkét tanulót látja');

-- A tanuló csak a sajátját látja, és a tesztpontosságot nem kapja meg.
select _login('00000000-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-0000000000c1');
select _t((select count(distinct student_id) = 1 from stats_daily()), 'tanuló: csak a saját napjai');
select _t((select count(*) = 0 from stats_weekly('00000000-0000-0000-0000-0000000000c2')),
          'tanuló: más tanuló heti adata üres');
select _t((select submitted = 2 and test_correct = 0 from stats_topics() where topic_name like 'Algebra%'),
          'tanuló: a helyes válaszok nem szivárognak ki');
reset role;

rollback;
