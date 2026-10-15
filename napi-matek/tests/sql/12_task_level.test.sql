-- =============================================================================
-- Szint (Érettségi / Egyetem): import és hétgenerátor-szűrés
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f0', 'tanar@example.com');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000f0', 'teacher');
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000f0');

select import_tasks('[
  {"title":"Ér","body_md":"x","topic_slug":"komplex-szamok","difficulty":2},
  {"title":"Egy","body_md":"y","topic_slug":"komplex-szamok","difficulty":2,"level":"egyetem"}]'::jsonb);
select _t((select level = 'erettsegi' from tasks where title = 'Ér'), 'alapból érettségi szint');
select _t((select level = 'egyetem' from tasks where title = 'Egy'), 'az importált egyetemi szint megmarad');
select _t((select count(*) from topics where slug = 'testek' and not retired) = 1, 'van Testek témakör');

with w as (insert into worksheets (title) values ('L') returning id)
select _t((select count(*) from w, generator_pool_v2(w.id, array[(select id from topics where slug = 'komplex-szamok')]::smallint[],
            array['teszt','rovid','kifejtos']::task_type[], array['egyetem']::task_level[], 1::smallint, 5::smallint, false) g
           where g.title = 'Egy') = 1
          and (select count(*) from worksheets w2, generator_pool_v2(w2.id, array[(select id from topics where slug = 'komplex-szamok')]::smallint[],
            array['teszt','rovid','kifejtos']::task_type[], array['egyetem']::task_level[], 1::smallint, 5::smallint, false) g
           where w2.title = 'L' and g.title = 'Ér') = 0,
          'a generátor szint szerint szűr');
reset role;
rollback;
