-- =============================================================================
-- Új témakörlista (28 témakör) és több témakör feladatonként
--
-- - topics: sorrend (sort_order) és visszavonás (retired): a régi, összevont
--   témakörök nem törlődnek (a régi adatok hivatkozhatnak rájuk), csak eltűnnek
--   a választékból.
-- - task_topics: egy feladathoz több témakör. A tasks.topic_id az „elsődleges”
--   témakör marad (rendezéshez, régi kódhoz); egy trigger gondoskodik róla,
--   hogy az elsődleges témakör mindig szerepeljen a task_topics-ban is.
-- =============================================================================

alter table public.topics
  add column sort_order smallint not null default 100,
  add column retired boolean not null default false;

-- A régi témakörök közül ami egy az egyben megmarad, azt átnevezzük/átsoroljuk,
-- a többit visszavonjuk (a feladatok átsorolása külön adatmódosítás).
update public.topics set retired = true
 where slug in ('halmazok-logika', 'algebra', 'fuggvenyek', 'geometria', 'valoszinuseg', 'analizis');

insert into public.topics (slug, name, sort_order) values
  ('abszolutertek-gyok',    'Abszolútérték, gyök', 1),
  ('egyenletek',            'Egyenletek, egyenlőtlenségek, egyenletrendszerek', 2),
  ('egyszerusites',         'Egyszerűsítés, átalakítás', 3),
  ('fuggvenytulajdonsagok', 'Függvénytulajdonságok és -transzformációk', 4),
  ('exponencialis',         'Exponenciális feladatok', 5),
  ('logaritmus',            'Logaritmusos feladatok', 6),
  ('fuggvenyanalizis',      'Függvényanalízis', 7),
  ('halmazok',              'Halmazok', 8),
  ('logika',                'Logika', 10),
  ('grafok',                'Gráfok', 11),
  ('sikgeometria',          'Síkgeometria', 12),
  ('sorozat-hatarertek',    'Sorozat határértéke', 14),
  ('statisztika',           'Statisztika', 15),
  ('szamelmelet',           'Számelmélet', 16),
  ('valoszinusegszamitas',  'Valószínűségszámítás', 18),
  ('matrixmuveletek',       'Mátrixműveletek', 20),
  ('sajatertek',            'Sajátérték, sajátvektor', 21),
  ('terbeli-vektorok',      'Térbeli vektorok', 22),
  ('terelemek',             'Térelemek megadása', 23),
  ('fuggvenyhatarertek',    'Függvényhatárérték', 24),
  ('szelsoertek',           'Szélsőértékkeresés', 25),
  ('erinto',                'Függvény érintője', 26),
  ('hatarozott-integral',   'Határozott integrál', 27),
  ('hatarozatlan-integral', 'Határozatlan integrál', 28);

update public.topics set sort_order = 9,  name = 'Koordinátageometria' where slug = 'koordinatageom';
update public.topics set sort_order = 13, name = 'Sorozatok'           where slug = 'sorozatok';
update public.topics set sort_order = 17, name = 'Trigonometria'       where slug = 'trigonometria';
update public.topics set sort_order = 19, name = 'Kombinatorika'       where slug = 'kombinatorika';
update public.topics set sort_order = 900 where retired;

-- Több témakör feladatonként ----------------------------------------------------
create table public.task_topics (
  task_id  uuid     not null references public.tasks(id) on delete cascade,
  topic_id smallint not null references public.topics(id),
  primary key (task_id, topic_id)
);
create index on public.task_topics (topic_id);

insert into public.task_topics (task_id, topic_id) select id, topic_id from public.tasks;

-- Az elsődleges témakör mindig szerepeljen a listában is.
create or replace function public._task_primary_topic() returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  insert into task_topics (task_id, topic_id) values (new.id, new.topic_id)
  on conflict do nothing;
  return new;
end $$;

create trigger tasks_primary_topic
  after insert or update of topic_id on public.tasks
  for each row execute function public._task_primary_topic();

alter table public.task_topics enable row level security;
create policy teacher_all on public.task_topics for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
-- A tanuló a neki már látható feladatok témaköreit látja (a statisztikához).
create policy student_visible_task_topics on public.task_topics for select to authenticated
  using (exists (
    select 1 from public.student_tasks st
     where st.task_id = task_topics.task_id
       and st.student_id = public.current_student_id()
       and st.scheduled_date <= public.today_bp()));

revoke all on public.task_topics from anon;
grant select, insert, delete on public.task_topics to authenticated;

-- Egy feladat témaköreinek beállítása: az első lesz az elsődleges.
create or replace function public.set_task_topics(p_task_id uuid, p_topic_ids smallint[])
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  if coalesce(array_length(p_topic_ids, 1), 0) = 0 then
    raise exception 'no_topic' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_topic_ids) x(id)
              where not exists (select 1 from topics where topics.id = x.id and not retired)) then
    raise exception 'unknown_topic' using errcode = 'P0001';
  end if;
  update tasks set topic_id = p_topic_ids[1] where id = p_task_id;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  delete from task_topics where task_id = p_task_id and topic_id <> all (p_topic_ids);
  insert into task_topics (task_id, topic_id) select p_task_id, x from unnest(p_topic_ids) x
  on conflict do nothing;
end $$;

revoke execute on function public.set_task_topics(uuid, smallint[]) from public, anon, authenticated;
grant execute on function public.set_task_topics(uuid, smallint[]) to authenticated;

-- Import: a sor több témakört is kaphat (topic_slugs tömb; a régi topic_slug is jó).
create or replace function public.import_tasks(p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_row jsonb;
  v_slugs text[];
  v_topics smallint[];
  v_task uuid;
  v_count int := 0;
  v_solution text;
  v_choice text;
begin
  perform _assert_teacher();
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_not_array' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_slugs := case
      when jsonb_typeof(v_row -> 'topic_slugs') = 'array'
        then array(select jsonb_array_elements_text(v_row -> 'topic_slugs'))
      else array[v_row ->> 'topic_slug'] end;
    select array_agg(t.id order by s.ord) into v_topics
      from unnest(v_slugs) with ordinality s(slug, ord)
      join topics t on t.slug = s.slug and not t.retired;
    if v_topics is null or array_length(v_topics, 1) <> array_length(v_slugs, 1) then
      raise exception 'unknown_topic: %', array_to_string(v_slugs, ',') using errcode = 'P0001';
    end if;

    v_choice := nullif(upper(btrim(coalesce(v_row ->> 'correct_choice', ''))), '');
    if v_choice is not null and v_choice !~ '^[A-F]$' then
      raise exception 'invalid_choice: %', v_choice using errcode = 'P0001';
    end if;

    insert into tasks (title, body_md, topic_id, difficulty, requires_image, figure_path, task_type, est_minutes)
    values (btrim(v_row ->> 'title'), v_row ->> 'body_md', v_topics[1],
            (v_row ->> 'difficulty')::smallint,
            coalesce((v_row ->> 'requires_image')::boolean, true),
            nullif(v_row ->> 'figure_path', ''),
            coalesce(nullif(v_row ->> 'task_type', '')::task_type, 'kifejtos'),
            nullif(v_row ->> 'est_minutes', '')::smallint)
    returning id into v_task;
    insert into task_topics (task_id, topic_id) select v_task, x from unnest(v_topics) x
    on conflict do nothing;

    v_solution := coalesce(nullif(btrim(coalesce(v_row ->> 'solution_md', '')), ''), '');
    if v_solution <> '' or v_choice is not null then
      insert into task_solutions (task_id, solution_md, correct_choice) values (v_task, v_solution, v_choice);
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke execute on function public.import_tasks(jsonb) from public, anon, authenticated;
grant execute on function public.import_tasks(jsonb) to authenticated;

-- Hétgenerátor: a feladat bármelyik témaköre számít; a válasz az összes
-- témakört visszaadja.
drop function public.generator_pool(uuid, smallint[], public.task_type[], smallint, smallint, boolean);
create function public.generator_pool(
  p_worksheet_id uuid,
  p_topic_ids smallint[],
  p_types public.task_type[],
  p_difficulty_min smallint,
  p_difficulty_max smallint,
  p_only_unassigned boolean)
returns table (id uuid, title text, topic_ids smallint[], difficulty smallint,
               task_type public.task_type, est_minutes smallint)
language plpgsql stable security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  return query
  select t.id, t.title,
         (select array_agg(tt.topic_id order by tt.topic_id) from task_topics tt where tt.task_id = t.id),
         t.difficulty, t.task_type, t.est_minutes
    from tasks t
   where t.archived_at is null
     and exists (select 1 from task_topics tt where tt.task_id = t.id and tt.topic_id = any (p_topic_ids))
     and t.task_type = any (p_types)
     and t.difficulty between p_difficulty_min and p_difficulty_max
     and not exists (select 1 from worksheet_items wi
                      where wi.worksheet_id = p_worksheet_id and wi.task_id = t.id)
     and (not p_only_unassigned
          or not exists (select 1 from student_tasks st where st.task_id = t.id));
end $$;

revoke execute on function public.generator_pool(uuid, smallint[], public.task_type[], smallint, smallint, boolean)
  from public, anon, authenticated;
grant execute on function public.generator_pool(uuid, smallint[], public.task_type[], smallint, smallint, boolean)
  to authenticated;

-- Statisztika: témakörönként (egy feladat minden témakörébe beszámít), plusz
-- egy topic_id = 0 „Összesen” sor, amelyben minden feladat egyszer szerepel.
create or replace function public.stats_topics(p_student_id uuid default null)
returns table (
  student_id uuid, topic_id smallint, topic_name text,
  assigned int, submitted int, accepted int, needs_revision int, late int,
  test_checked int, test_correct int)
language sql stable security invoker
set search_path = public as $$
  with base as (
    select st.id, st.student_id, st.task_id, st.status, st.is_late, st.first_submitted_at,
           t.task_type, sol.correct_choice, latest.choice
      from student_tasks st
      join tasks t on t.id = st.task_id
      left join task_solutions sol on sol.task_id = t.id
      left join lateral (
        select s.choice from submissions s
         where s.student_task_id = st.id and s.submitted_at is not null
         order by s.version desc limit 1
      ) latest on true
     where (p_student_id is null or st.student_id = p_student_id)
       and st.scheduled_date <= today_bp()
  )
  select student_id, topic_id, topic_name,
         count(*)::int,
         count(*) filter (where first_submitted_at is not null)::int,
         count(*) filter (where status = 'accepted')::int,
         count(*) filter (where status = 'needs_revision')::int,
         count(*) filter (where is_late)::int,
         count(*) filter (where task_type = 'teszt' and correct_choice is not null and choice is not null)::int,
         count(*) filter (where task_type = 'teszt' and choice = correct_choice)::int
    from (select b.student_id, tp.id as topic_id, tp.name as topic_name, tp.sort_order,
                 b.first_submitted_at, b.status, b.is_late, b.task_type, b.correct_choice, b.choice
            from base b
            join task_topics tt on tt.task_id = b.task_id
            join topics tp on tp.id = tt.topic_id
          union all
          select b.student_id, 0::smallint, 'Összesen', 10000::smallint,
                 b.first_submitted_at, b.status, b.is_late, b.task_type, b.correct_choice, b.choice
            from base b) x
   group by student_id, topic_id, topic_name, sort_order
   order by student_id, sort_order
$$;
