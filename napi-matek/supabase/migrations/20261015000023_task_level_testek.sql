-- =============================================================================
-- Szint (Érettségi / Egyetem) feladatonként, és a „Testek” témakör
-- =============================================================================

create type public.task_level as enum ('erettsegi', 'egyetem');
alter table public.tasks add column level public.task_level not null default 'erettsegi';
create index tasks_level_idx on public.tasks (level) where archived_at is null;

-- „Testek” külön témakör, a Térgeometria után.
update public.topics set sort_order = sort_order + 1 where not retired and sort_order >= 14;
insert into public.topics (slug, name, sort_order) values ('testek', 'Testek', 14);

-- Import: a szint is jöhet (alapból érettségi).
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

    insert into tasks (title, body_md, topic_id, difficulty, requires_image, figure_path, task_type, est_minutes, level)
    values (btrim(v_row ->> 'title'), v_row ->> 'body_md', v_topics[1],
            (v_row ->> 'difficulty')::smallint,
            coalesce((v_row ->> 'requires_image')::boolean, true),
            nullif(v_row ->> 'figure_path', ''),
            coalesce(nullif(v_row ->> 'task_type', '')::task_type, 'kifejtos'),
            nullif(v_row ->> 'est_minutes', '')::smallint,
            coalesce(nullif(v_row ->> 'level', '')::task_level, 'erettsegi'))
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

-- Hétgenerátor szintszűréssel (új név, hogy a régit ne kelljen eldobni).
create or replace function public.generator_pool_v2(
  p_worksheet_id uuid,
  p_topic_ids smallint[],
  p_types public.task_type[],
  p_levels public.task_level[],
  p_difficulty_min smallint,
  p_difficulty_max smallint,
  p_only_unassigned boolean)
returns table (id uuid, title text, topic_ids smallint[], difficulty smallint,
               task_type public.task_type, est_minutes smallint)
language plpgsql volatile security definer
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
     and t.level = any (p_levels)
     and t.difficulty between p_difficulty_min and p_difficulty_max
     and not exists (select 1 from worksheet_items wi
                      where wi.worksheet_id = p_worksheet_id and wi.task_id = t.id)
     and (not p_only_unassigned
          or not exists (select 1 from student_tasks st where st.task_id = t.id))
   order by random();
end $$;

revoke execute on function public.generator_pool_v2(uuid, smallint[], public.task_type[], public.task_level[], smallint, smallint, boolean)
  from public, anon, authenticated;
grant execute on function public.generator_pool_v2(uuid, smallint[], public.task_type[], public.task_level[], smallint, smallint, boolean)
  to authenticated;
