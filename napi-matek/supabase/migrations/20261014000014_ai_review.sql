-- =============================================================================
-- Tesztek automatikus javítása és AI-ellenőrző asszisztens
-- =============================================================================

-- 1) Helyes válasz a feleletválasztós feladatokhoz. A megoldási útmutató mellett,
--    a csak tanár által olvasható táblában – a tanuló így beadás előtt sem
--    juthat hozzá.
alter table public.task_solutions
  add column correct_choice text check (correct_choice ~ '^[A-F]$');

-- Teszthez elég lehet a helyes betű, útmutató nélkül is.
alter table public.task_solutions alter column solution_md set default '';

-- A meglévő tesztfeladatok útmutatója „Helyes válasz: (B) …” formájú:
-- ebből kiolvassuk a betűt (ahol nem egyértelmű, üresen marad).
update public.task_solutions s
   set correct_choice = upper((regexp_match(s.solution_md, 'helyes\s+v[áa]lasz\s*:?\s*\(?([A-Fa-f])\)', 'i'))[1])
  from public.tasks t
 where t.id = s.task_id
   and t.task_type = 'teszt'
   and s.correct_choice is null
   and s.solution_md ~* 'helyes\s+v[áa]lasz\s*:?\s*\(?[A-F]\)';

-- Import: a helyes válasz is jöhet (correct_choice).
create or replace function public.import_tasks(p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_row jsonb;
  v_topic smallint;
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
    select id into v_topic from topics where slug = v_row ->> 'topic_slug';
    if v_topic is null then
      raise exception 'unknown_topic: %', v_row ->> 'topic_slug' using errcode = 'P0001';
    end if;

    v_choice := nullif(upper(btrim(coalesce(v_row ->> 'correct_choice', ''))), '');
    if v_choice is not null and v_choice !~ '^[A-F]$' then
      raise exception 'invalid_choice: %', v_choice using errcode = 'P0001';
    end if;

    insert into tasks (title, body_md, topic_id, difficulty, requires_image, figure_path, task_type, est_minutes)
    values (btrim(v_row ->> 'title'), v_row ->> 'body_md', v_topic,
            (v_row ->> 'difficulty')::smallint,
            coalesce((v_row ->> 'requires_image')::boolean, true),
            nullif(v_row ->> 'figure_path', ''),
            coalesce(nullif(v_row ->> 'task_type', '')::task_type, 'kifejtos'),
            nullif(v_row ->> 'est_minutes', '')::smallint)
    returning id into v_task;

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

-- 2) AI-javaslatok. Csak a tanár látja; a tanulóhoz semmi nem jut el belőle,
--    amíg a tanár saját döntésként el nem küldi.
create table public.ai_reviews (
  id              uuid primary key default gen_random_uuid(),
  student_task_id uuid not null references public.student_tasks(id) on delete cascade,
  -- A javaslat erre a beadott változatra szól; új változatnál új javaslat kell.
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  model           text not null,
  -- A modell strukturált válasza: verdict, confidence, summary, issues[], feedback_md, …
  result          jsonb not null,
  input_tokens    int,
  output_tokens   int,
  created_by      uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now()
);
create index on public.ai_reviews (submission_id, created_at desc);

alter table public.ai_reviews enable row level security;
create policy teacher_all on public.ai_reviews for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

revoke all on public.ai_reviews from anon;
grant select, insert, delete on public.ai_reviews to authenticated;
