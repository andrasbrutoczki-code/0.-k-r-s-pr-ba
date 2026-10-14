-- =============================================================================
-- 2. lépés: munkalapok, ütemezés, csoportos kiosztás, tanulónkénti módosítás, import
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 's-b@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 's-c@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a4', 's-d@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

select _t((select count(*) from tasks) = 5, 'a seed 5 mintafeladatot tartalmaz');
select _t((select count(*) from task_solutions) = 5, 'mind az 5 mintafeladathoz van megoldási útmutató');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
select create_student('00000000-0000-0000-0000-0000000000a2', 'Bence');
select create_student('00000000-0000-0000-0000-0000000000a3', 'Csenge');
select create_student('00000000-0000-0000-0000-0000000000a4', 'Dani');

-- Munkalap 7 tétellel: az alapértelmezett ütemezés H, K, Sze, Cs, P, Szo, majd 2. hét H.
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
with w as (insert into worksheets (title) values ('1. hét') returning id) insert into ids select 'ws', id from w;
do $$
declare t uuid;
begin
  for t in select id from tasks order by title loop
    perform add_worksheet_item((select v from ids where k = 'ws'), t);
  end loop;
  perform add_worksheet_item((select v from ids where k = 'ws'), (select id from tasks order by title limit 1));
  perform add_worksheet_item((select v from ids where k = 'ws'), (select id from tasks order by title offset 1 limit 1));
end $$;

select _t(
  (select array_agg(week_no::text || '/' || day_no::text order by position)
     from worksheet_items where worksheet_id = (select v from ids where k = 'ws'))
  = array['1/1','1/2','1/3','1/4','1/5','1/6','2/1'],
  'add_worksheet_item: H→Szo után a következő hét hétfője');

-- Sorrendcsere: a 2. tétel felkerül az 1. helyre.
select move_worksheet_item(
  (select id from worksheet_items where worksheet_id = (select v from ids where k = 'ws') and position = 2), -1);
select _t(
  (select array_agg(position order by position) from worksheet_items
    where worksheet_id = (select v from ids where k = 'ws')) = array[1,2,3,4,5,6,7],
  'move_worksheet_item: a pozíciók folytonosak maradnak');
select move_worksheet_item(
  (select id from worksheet_items where worksheet_id = (select v from ids where k = 'ws') and position = 1), -1);
select _t(true, 'move_worksheet_item: az első tétel felfelé mozgatása nem hiba');

-- Kiosztás: egy művelet, 3 tanuló. Vasárnapi kezdés nem lehet.
do $$ begin
  perform assign_worksheet((select v from ids where k = 'ws'), '2026-10-18',
    array['00000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL: vasárnapi kezdőnap elfogadva';
exception when raise_exception then
  if sqlerrm <> 'start_is_sunday' then raise; end if;
  raise notice 'ok  - vasárnapra nem eshet a kezdőnap';
end $$;

insert into ids values ('as', assign_worksheet((select v from ids where k = 'ws'), '2026-10-12',
  array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000a3']::uuid[]));
select _t((select count(*) from student_tasks where assignment_id = (select v from ids where k = 'as')) = 21,
          'egy művelettel 3 tanuló × 7 feladat = 21 kiosztott feladat');
select _t((select count(distinct student_id) from student_tasks
            where assignment_id = (select v from ids where k = 'as')) = 3,
          'pontosan a 3 kiválasztott tanuló kapta meg');
select _t(
  (select array_agg(distinct scheduled_date::text || '>' || due_date::text order by scheduled_date::text || '>' || due_date::text)
     from student_tasks where assignment_id = (select v from ids where k = 'as'))
  = array['2026-10-12>2026-10-18','2026-10-13>2026-10-18','2026-10-14>2026-10-18',
          '2026-10-15>2026-10-18','2026-10-16>2026-10-18','2026-10-17>2026-10-18',
          '2026-10-19>2026-10-25'],
  'ütemezés: H–Szo az 1. héten (határidő vasárnap), a 7. tétel a 2. hét hétfője');

-- Szerdai kezdés: a tételek gyakorlási napokban tolódnak, vasárnap kimarad.
insert into ids values ('as_wed', assign_worksheet((select v from ids where k = 'ws'), '2026-10-14',
  array['00000000-0000-0000-0000-0000000000a1']::uuid[]));
select _t(
  (select array_agg(scheduled_date::text || '>' || due_date::text order by scheduled_date)
     from student_tasks where assignment_id = (select v from ids where k = 'as_wed'))
  = array['2026-10-14>2026-10-18','2026-10-15>2026-10-18','2026-10-16>2026-10-18',
          '2026-10-17>2026-10-18','2026-10-19>2026-10-25','2026-10-20>2026-10-25',
          '2026-10-21>2026-10-25'],
  'szerdai kezdés: Sze, Cs, P, Szo, majd H, K, Sze; határidő az adott hét vasárnapja');
select _t((select bool_and(extract(isodow from scheduled_date) <> 7) from student_tasks),
          'egyetlen feladat sem esik vasárnapra');
reset role;
select _t(_add_practice_days('2026-10-12', 0) = '2026-10-12' and _add_practice_days('2026-10-12', 6) = '2026-10-19'
          and _add_practice_days('2026-10-17', 1) = '2026-10-19',
          '_add_practice_days: hétfőtől 6 nap = következő hétfő, szombat után hétfő');
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');

-- Letiltott tanuló nem kaphat kiosztást.
select set_student_disabled('00000000-0000-0000-0000-0000000000a4', true);
do $$ begin
  perform assign_worksheet((select v from ids where k = 'ws'), '2026-10-19',
    array['00000000-0000-0000-0000-0000000000a4']::uuid[]);
  raise exception 'FAIL: letiltott tanuló kiosztást kapott';
exception when raise_exception then
  if sqlerrm <> 'invalid_student' then raise; end if;
  raise notice 'ok  - letiltott tanulónak nem osztható ki';
end $$;

-- A munkalap későbbi szerkesztése nem írja át a kiosztást.
update worksheet_items set day_no = 6 where worksheet_id = (select v from ids where k = 'ws');
select _t((select count(*) from student_tasks
            where assignment_id = (select v from ids where k = 'as') and scheduled_date = '2026-10-12') = 3,
          'a munkalap utólagos módosítása nem változtatja a kiosztott ütemezést');

-- Tanulónkénti módosítás: csak Anna egy feladatát mozgatjuk és cseréljük.
insert into ids values ('st', (select id from student_tasks
  where assignment_id = (select v from ids where k = 'as')
    and student_id = '00000000-0000-0000-0000-0000000000a1' and scheduled_date = '2026-10-12'));
select reschedule_student_task((select v from ids where k = 'st'), '2026-10-21');
select _t((select scheduled_date = '2026-10-21' and due_date = '2026-10-25'
             from student_tasks where id = (select v from ids where k = 'st')),
          'eltolás: új nap, határidő az új hét vasárnapja');
select _t((select count(*) from student_tasks
            where assignment_id = (select v from ids where k = 'as') and scheduled_date = '2026-10-12') = 2,
          'a másik két tanuló ütemezése változatlan');
do $$ begin
  perform reschedule_student_task((select v from ids where k = 'st'), '2026-10-18');
  raise exception 'FAIL: vasárnapra ütemezhető';
exception when raise_exception then
  if sqlerrm <> 'sunday_not_allowed' then raise; end if;
  raise notice 'ok  - vasárnapra nem ütemezhető';
end $$;

select swap_student_task((select v from ids where k = 'st'),
  (select id from tasks order by title desc limit 1));
select _t((select task_id = (select id from tasks order by title desc limit 1)
             from student_tasks where id = (select v from ids where k = 'st')),
          'feladatcsere beadás előtt működik');
reset role;
update student_tasks set status = 'submitted' where id = (select v from ids where k = 'st');
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
do $$ begin
  perform swap_student_task((select v from ids where k = 'st'), (select id from tasks limit 1));
  raise exception 'FAIL: beadott feladat cserélhető';
exception when raise_exception then
  if sqlerrm <> 'not_swappable' then raise; end if;
  raise notice 'ok  - beadott feladat nem cserélhető';
end $$;

-- Másolás sablonként.
insert into ids values ('tpl', duplicate_worksheet((select v from ids where k = 'ws'), true, 'Sablon'));
select _t((select is_template and title = 'Sablon' from worksheets where id = (select v from ids where k = 'tpl')),
          'duplicate_worksheet: sablon jön létre');
select _t((select count(*) from worksheet_items where worksheet_id = (select v from ids where k = 'tpl')) = 7,
          'a sablon minden tételt átvesz');

-- Import: atomikus, hibás témakörnél semmi sem kerül be.
select _t(import_tasks('[
  {"title":"I1","body_md":"$1+1$","topic_slug":"algebra","difficulty":1,"requires_image":false},
  {"title":"I2","body_md":"$x$","topic_slug":"geometria","difficulty":5,"requires_image":true,"solution_md":"m"}
]'::jsonb) = 2, 'import_tasks: 2 feladat beszúrva');
select _t((select count(*) from task_solutions ts join tasks t on t.id = ts.task_id where t.title = 'I2') = 1,
          'import: a megoldási útmutató is bekerül');
do $$ begin
  perform import_tasks('[{"title":"I3","body_md":"x","topic_slug":"algebra","difficulty":2},
                         {"title":"I4","body_md":"x","topic_slug":"nincs-ilyen","difficulty":2}]'::jsonb);
  raise exception 'FAIL: ismeretlen témakör elfogadva';
exception when raise_exception then
  if sqlerrm not like 'unknown_topic%' then raise; end if;
  raise notice 'ok  - ismeretlen témakör → az egész import elutasítva';
end $$;
select _t(not exists (select 1 from tasks where title = 'I3'), 'hibás importnál egy sor sem kerül be');

-- Tanuló nem hívhatja a tanári függvényeket.
select _login('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform assign_worksheet((select v from ids where k = 'ws'), '2026-10-19',
    array['00000000-0000-0000-0000-0000000000a1']::uuid[]);
  raise exception 'FAIL: tanuló kioszthatott';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem oszthat ki munkalapot';
end $$;
reset role;

rollback;
