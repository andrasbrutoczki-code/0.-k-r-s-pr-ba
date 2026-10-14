-- =============================================================================
-- Napi összefoglaló tartalma
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000e1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 's-b@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000e0', 'teacher');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000e0');
select create_student('00000000-0000-0000-0000-0000000000e1', 'Anna <b>');
select create_student('00000000-0000-0000-0000-0000000000e2', 'Bence');
select import_tasks('[{"title":"Egy","body_md":"x","topic_slug":"egyenletek","difficulty":1},
                      {"title":"Kettő","body_md":"y","topic_slug":"egyenletek","difficulty":1}]'::jsonb);
with w as (insert into worksheets (title) values ('D') returning id)
select add_worksheet_item(w.id, t.id) from w, tasks t where t.title in ('Egy', 'Kettő');
select assign_worksheet((select id from worksheets where title = 'D'), '2026-10-12',
  array['00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2']::uuid[]);
reset role;

-- Mindkét feladat hétfőn (10-12) esedékes; Anna hétfőn beadja az egyiket, Bence semmit.
update student_tasks set scheduled_date = '2026-10-12', due_date = '2026-10-18';
insert into submissions (student_task_id, version, submitted_at)
select st.id, 1, '2026-10-12 15:00+00' from student_tasks st join tasks t on t.id = st.task_id
 where st.student_id = '00000000-0000-0000-0000-0000000000e1' and t.title = 'Egy';
update student_tasks st set status = 'submitted', first_submitted_at = '2026-10-12 15:00+00', last_submitted_at = '2026-10-12 15:00+00'
  from tasks t where t.id = st.task_id and st.student_id = '00000000-0000-0000-0000-0000000000e1' and t.title = 'Egy';

select _t((select to_review = 1 from daily_digest_content('2026-10-13')), 'egy beadás vár ellenőrzésre');
select _t((select html like '%Bence – 2 feladat%' from daily_digest_content('2026-10-13')),
          'Bence az előző tanítási napon nem adott be semmit');
select _t((select html not like '%<li>Anna &lt;b&gt; – 2 feladat%' from daily_digest_content('2026-10-13')),
          'Anna beadott valamit, nincs a kimaradók között');
select _t((select html like '%Anna &lt;b&gt;%' and html not like '%Anna <b>%' from daily_digest_content('2026-10-13')),
          'a nevek HTML-escape-elve');
select _t((select html like '%2026.10.09.%' from daily_digest_content('2026-10-12')),
          'hétfőn a pénteki nap az előző tanítási nap');
select _t((select html like '%Lejárt határidő%' from daily_digest_content('2026-10-19')),
          'a vasárnapi határidő után a be nem adottak megjelennek');
select _t((select subject like 'Napi matek – 1 ellenőrzésre vár%' from daily_digest_content('2026-10-13')), 'tárgy');

-- Tanár/tanuló nem hívhatja (csak a szerver ütemezője).
set local role authenticated;
do $$ begin
  perform daily_digest_content('2026-10-13');
  raise exception 'FAIL: kliens hívhatta';
exception when insufficient_privilege then
  raise notice 'ok  - a tartalomfüggvény kliensből nem hívható';
end $$;
reset role;

rollback;
