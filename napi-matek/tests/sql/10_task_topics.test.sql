-- =============================================================================
-- Több témakör feladatonként: import, beállítás, hétgenerátor, statisztika
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000d1', 's-a@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000d0', 'teacher');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000d0');

select _t((select count(*) from topics where not retired) = 29, 'az új lista 29 aktív témakör');
select _t((select string_agg(name, '|' order by sort_order) from (select name, sort_order from topics where not retired order by sort_order limit 2) x)
          = 'Abszolútérték, gyök|Egyenletek, egyenlőtlenségek, egyenletrendszerek', 'a sorrend a tanári lista szerinti');

select _t(import_tasks('[
  {"title":"Exp-log","body_md":"x","topic_slugs":["logaritmus","exponencialis"],"difficulty":3},
  {"title":"Egy","body_md":"y","topic_slug":"halmazok","difficulty":1}]'::jsonb) = 2, 'import több témakörrel');
select _t((select t.topic_id = (select id from topics where slug = 'logaritmus') from tasks t where title = 'Exp-log'),
          'az első témakör az elsődleges');
select _t((select count(*) from task_topics tt join tasks t on t.id = tt.task_id where t.title = 'Exp-log') = 2,
          'mindkét témakör rögzítve');
do $$ begin
  perform import_tasks('[{"title":"R","body_md":"x","topic_slug":"algebra","difficulty":1}]'::jsonb);
  raise exception 'FAIL: visszavont témakörbe importálható';
exception when raise_exception then
  if sqlerrm not like 'unknown_topic%' then raise; end if;
  raise notice 'ok  - visszavont témakörbe nem lehet importálni';
end $$;

-- Beállítás: csere, az elsődleges követi az első elemet.
select set_task_topics((select id from tasks where title = 'Egy'),
  array[(select id from topics where slug = 'logika'), (select id from topics where slug = 'halmazok')]::smallint[]);
select _t((select array_agg(tp.slug order by tp.slug) from task_topics tt join topics tp on tp.id = tt.topic_id
             join tasks t on t.id = tt.task_id where t.title = 'Egy') = array['halmazok', 'logika'],
          'témakörök beállítva');
select _t((select tp.slug from tasks t join topics tp on tp.id = t.topic_id where t.title = 'Egy') = 'logika',
          'elsődleges: az első');
select set_task_topics((select id from tasks where title = 'Egy'), array[(select id from topics where slug = 'grafok')]::smallint[]);
select _t((select count(*) from task_topics tt join tasks t on t.id = tt.task_id where t.title = 'Egy') = 1,
          'a kivett témakörök törlődnek');

-- Hétgenerátor: a másodlagos témakör is talál.
with w as (insert into worksheets (title) values ('G') returning id)
select _t((select count(*) from w, generator_pool(w.id, array[(select id from topics where slug = 'exponencialis')]::smallint[],
            array['teszt','rovid','kifejtos']::task_type[], 1::smallint, 5::smallint, false) g where g.title = 'Exp-log') = 1,
          'a generátor a másodlagos témakör szerint is választ');

-- Statisztika: témakörönként mindkét helyen, az összesítőben egyszer.
select create_student('00000000-0000-0000-0000-0000000000d1', 'Anna');
with w as (insert into worksheets (title) values ('S') returning id)
select add_worksheet_item(w.id, (select id from tasks where title = 'Exp-log')) from w;
select assign_worksheet((select id from worksheets where title = 'S'), '2026-10-05',
  array['00000000-0000-0000-0000-0000000000d1']::uuid[]);
select _t((select count(*) from stats_topics() where topic_id > 0 and assigned = 1) = 2,
          'a feladat mindkét témakörében megjelenik');
select _t((select assigned from stats_topics() where topic_id = 0) = 1, 'az összesítőben egyszer számít');
reset role;

rollback;
