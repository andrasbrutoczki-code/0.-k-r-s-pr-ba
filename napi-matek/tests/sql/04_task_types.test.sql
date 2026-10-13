-- =============================================================================
-- Feladattípus, import típussal, tömeges tételfelvétel (hétgenerátor)
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

select _t((select bool_and(task_type = 'kifejtos') from tasks), 'a képpel beadandó seed feladatok kifejtősek');

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select import_tasks('[
  {"title":"T","body_md":"x?\n(A) 1\n(B) 2","topic_slug":"algebra","difficulty":1,"requires_image":false,"task_type":"teszt","est_minutes":3},
  {"title":"R","body_md":"x","topic_slug":"algebra","difficulty":2,"requires_image":false}
]'::jsonb);
select _t((select task_type = 'teszt' and est_minutes = 3 from tasks where title = 'T'), 'import: típus és idő átvéve');
select _t((select task_type = 'kifejtos' and est_minutes is null from tasks where title = 'R'),
          'import: típus nélkül kifejtős, idő nélkül NULL (becsült)');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
with w as (insert into worksheets (title) values ('Gen') returning id) insert into ids select 'ws', id from w;
select add_worksheet_item((select v from ids where k = 'ws'), (select id from tasks where title = 'R'));
select _t(add_worksheet_items_bulk((select v from ids where k = 'ws'), (
  select jsonb_agg(jsonb_build_object('task_id', id, 'week_no', 2, 'day_no', n) order by n)
    from (select id, row_number() over (order by title) as n from tasks where title in ('T', 'R')) x
)) = 2, 'add_worksheet_items_bulk: 2 tétel');
select _t((select array_agg(position || ':' || week_no || '/' || day_no order by position)
             from worksheet_items where worksheet_id = (select v from ids where k = 'ws'))
          = array['1:1/1', '2:2/1', '3:2/2'], 'a tételek a munkalap végére kerülnek, a megadott ütemezéssel');
-- Generátor-készlet: a munkalapon lévő és a kiosztott feladatok kimaradnak.
select _t((select count(*) from generator_pool((select v from ids where k = 'ws'),
            array[(select id from topics where slug = 'algebra')]::smallint[],
            array['teszt','rovid','kifejtos']::task_type[], 1::smallint, 5::smallint, false)) = 0,
          'generator_pool: a munkalapon már szereplő feladatok kimaradnak');
select _t((select count(*) from generator_pool(gen_random_uuid(),
            array[(select id from topics where slug = 'algebra')]::smallint[],
            array['teszt']::task_type[], 1::smallint, 5::smallint, false)) = 1,
          'generator_pool: típusszűrés');
reset role;

rollback;
