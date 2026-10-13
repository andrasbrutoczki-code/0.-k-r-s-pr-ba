-- =============================================================================
-- Feladattípus, becsült megoldási idő, tömeges tételfelvétel (hétgenerátor)
-- =============================================================================

-- teszt     = feleletválasztós (A)–(D), pipával beadható
-- rovid     = rövid válaszos (egy eredmény)
-- kifejtos  = levezetés, fényképpel beadandó
create type public.task_type as enum ('teszt', 'rovid', 'kifejtos');

alter table public.tasks
  add column task_type public.task_type not null default 'kifejtos',
  -- Becsült megoldási idő percben. NULL = a típusból és nehézségből becsült érték
  -- (lásd src/lib/task-types.ts: estimateMinutes), amit a hétgenerátor használ.
  add column est_minutes smallint check (est_minutes between 1 and 120);

-- A meglévő feladatok besorolása a tartalmuk alapján:
-- (A) és (B) válaszlehetőség → teszt; kép nélkül beadható → rövid; egyébként kifejtős.
update public.tasks
   set task_type = case
         when body_md ~ '\(A\)' and body_md ~ '\(B\)' then 'teszt'::public.task_type
         when not requires_image then 'rovid'::public.task_type
         else 'kifejtos'::public.task_type
       end;

create index if not exists tasks_generator_idx
  on public.tasks (topic_id, task_type, difficulty) where archived_at is null;

-- Import: típus és becsült idő is jöhet (mindkettő opcionális).
create or replace function public.import_tasks(p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_row jsonb;
  v_topic smallint;
  v_task uuid;
  v_count int := 0;
begin
  perform _assert_teacher();
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_not_array' using errcode = 'P0001';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    select id into v_topic from topics where slug = v_row ->> 'topic_slug';
    if v_topic is null then
      raise exception 'unknown_topic: %', v_row ->> 'topic_slug' using errcode = 'P0001';
    end if;

    insert into tasks (title, body_md, topic_id, difficulty, requires_image, figure_path, task_type, est_minutes)
    values (btrim(v_row ->> 'title'), v_row ->> 'body_md', v_topic,
            (v_row ->> 'difficulty')::smallint,
            coalesce((v_row ->> 'requires_image')::boolean, true),
            nullif(v_row ->> 'figure_path', ''),
            coalesce(nullif(v_row ->> 'task_type', '')::task_type, 'kifejtos'),
            nullif(v_row ->> 'est_minutes', '')::smallint)
    returning id into v_task;

    if nullif(btrim(coalesce(v_row ->> 'solution_md', '')), '') is not null then
      insert into task_solutions (task_id, solution_md) values (v_task, v_row ->> 'solution_md');
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- A hétgenerátor jóváhagyott javaslatának felvétele egy tranzakcióban.
-- p_items: [{ "task_id": uuid, "week_no": int, "day_no": 1..6 }, ...] – a megadott
-- sorrendben kerülnek a munkalap végére.
create or replace function public.add_worksheet_items_bulk(p_worksheet_id uuid, p_items jsonb)
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_pos int;
  v_item jsonb;
  v_count int := 0;
begin
  perform _assert_teacher();
  if not exists (select 1 from worksheets where id = p_worksheet_id) then
    raise exception 'worksheet_not_found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) i
      join tasks t on t.id = (i ->> 'task_id')::uuid
     where t.archived_at is not null) then
    raise exception 'task_archived' using errcode = 'P0001';
  end if;

  select coalesce(max(position), 0) into v_pos from worksheet_items where worksheet_id = p_worksheet_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    insert into worksheet_items (worksheet_id, task_id, position, week_no, day_no)
    values (p_worksheet_id, (v_item ->> 'task_id')::uuid, v_pos,
            (v_item ->> 'week_no')::smallint, (v_item ->> 'day_no')::smallint);
    v_count := v_count + 1;
  end loop;

  update worksheets set updated_at = now() where id = p_worksheet_id;
  return v_count;
end $$;

revoke execute on function public.add_worksheet_items_bulk(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_worksheet_items_bulk(uuid, jsonb) to authenticated;
