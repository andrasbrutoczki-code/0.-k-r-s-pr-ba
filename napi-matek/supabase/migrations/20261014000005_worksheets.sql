-- =============================================================================
-- 2. lépés: feladatbank, munkalapok, csoportos kiosztás, import
--
-- Az egyszerű írások (feladat mentése, munkalap átnevezése, tétel törlése) a
-- tanár saját kliensével, RLS alatt futnak (teacher_all policy). RPC csak ott
-- van, ahol több sort kell atomikusan írni, vagy üzleti szabályt kell
-- kikényszeríteni (kiosztás, sorrendcsere, tanulónkénti módosítás, import).
-- =============================================================================

-- Gyakorlási hét napjai: 1 = hétfő … 6 = szombat (ismétlés/pótlás), vasárnap szünnap.
-- Egy tétel ütemezett napja a kiosztás kezdő hétfőjéhez képest:
--   scheduled = start + 7·(hét−1) + (nap−1),   határidő = start + 7·(hét−1) + 6 (vasárnap)

create or replace function public._sunday_of_week(d date) returns date
language sql immutable set search_path = '' as $$
  select d + (7 - extract(isodow from d)::int)
$$;

-- -----------------------------------------------------------------------------
-- Munkalap tételei
-- -----------------------------------------------------------------------------

-- Új tétel a munkalap végére. Alapértelmezett ütemezés: az utolsó tétel utáni
-- nap (szombat után a következő hét hétfője); üres munkalapon 1. hét hétfő.
create or replace function public.add_worksheet_item(p_worksheet_id uuid, p_task_id uuid)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_last record;
  v_week smallint := 1;
  v_day smallint := 1;
  v_id uuid;
begin
  perform _assert_teacher();
  if exists (select 1 from tasks where id = p_task_id and archived_at is not null) then
    raise exception 'task_archived' using errcode = 'P0001';
  end if;

  select position, week_no, day_no into v_last
    from worksheet_items where worksheet_id = p_worksheet_id
   order by position desc limit 1;

  if found then
    if v_last.day_no >= 6 then
      v_week := v_last.week_no + 1; v_day := 1;
    else
      v_week := v_last.week_no; v_day := v_last.day_no + 1;
    end if;
  end if;

  insert into worksheet_items (worksheet_id, task_id, position, week_no, day_no)
  values (p_worksheet_id, p_task_id, coalesce(v_last.position, 0) + 1, v_week, v_day)
  returning id into v_id;

  update worksheets set updated_at = now() where id = p_worksheet_id;
  return v_id;
end $$;

-- Tétel fel/le mozgatása: helycsere a szomszédjával. Az egyedi (worksheet_id,
-- position) kulcs miatt ideiglenes negatív pozíción keresztül cserélünk.
create or replace function public.move_worksheet_item(p_item_id uuid, p_direction int)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_item worksheet_items;
  v_other worksheet_items;
begin
  perform _assert_teacher();
  select * into v_item from worksheet_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;

  if p_direction < 0 then
    select * into v_other from worksheet_items
     where worksheet_id = v_item.worksheet_id and position < v_item.position
     order by position desc limit 1;
  else
    select * into v_other from worksheet_items
     where worksheet_id = v_item.worksheet_id and position > v_item.position
     order by position asc limit 1;
  end if;
  if not found then return; end if;  -- már a szélén van

  update worksheet_items set position = -v_item.position where id = v_item.id;
  update worksheet_items set position = v_item.position where id = v_other.id;
  update worksheet_items set position = v_other.position where id = v_item.id;
end $$;

-- Munkalap másolása (sablonként vagy sima másolatként). A tételek ütemezése megmarad.
create or replace function public.duplicate_worksheet(
  p_worksheet_id uuid, p_as_template boolean, p_title text default null)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_src worksheets;
  v_id uuid;
begin
  perform _assert_teacher();
  select * into v_src from worksheets where id = p_worksheet_id;
  if not found then
    raise exception 'worksheet_not_found' using errcode = 'P0002';
  end if;

  insert into worksheets (title, description, is_template)
  values (coalesce(nullif(btrim(p_title), ''), v_src.title || ' (másolat)'),
          v_src.description, p_as_template)
  returning id into v_id;

  insert into worksheet_items (worksheet_id, task_id, position, week_no, day_no)
  select v_id, task_id, position, week_no, day_no
    from worksheet_items where worksheet_id = p_worksheet_id;

  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- Csoportos kiosztás
-- -----------------------------------------------------------------------------

-- Egy munkalap kiosztása több tanulónak EGY tranzakcióban. Tanulónként
-- materializálja a feladatokat, így azok utólag egyenként módosíthatók, és a
-- munkalap későbbi szerkesztése nem írja át a már kiosztottakat.
create or replace function public.assign_worksheet(
  p_worksheet_id uuid, p_start_date date, p_student_ids uuid[])
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_assignment uuid;
begin
  perform _assert_teacher();

  if p_start_date is null or extract(isodow from p_start_date) <> 1 then
    raise exception 'start_not_monday' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_student_ids), 0) = 0 then
    raise exception 'no_students' using errcode = 'P0001';
  end if;
  if not exists (select 1 from worksheet_items where worksheet_id = p_worksheet_id) then
    raise exception 'empty_worksheet' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from worksheet_items wi join tasks t on t.id = wi.task_id
     where wi.worksheet_id = p_worksheet_id and t.archived_at is not null) then
    raise exception 'archived_task' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_student_ids) as sid
     where not exists (select 1 from students s where s.id = sid and s.disabled_at is null)) then
    raise exception 'invalid_student' using errcode = 'P0001';
  end if;

  insert into assignments (worksheet_id, start_date)
  values (p_worksheet_id, p_start_date)
  returning id into v_assignment;

  insert into student_tasks
    (assignment_id, student_id, task_id, worksheet_item_id, position, scheduled_date, due_date)
  select v_assignment, s.sid, wi.task_id, wi.id, wi.position,
         p_start_date + 7 * (wi.week_no - 1) + (wi.day_no - 1),
         p_start_date + 7 * (wi.week_no - 1) + 6
    from (select distinct unnest(p_student_ids) as sid) s
   cross join worksheet_items wi
   where wi.worksheet_id = p_worksheet_id;

  return v_assignment;
end $$;

-- Tanulónkénti módosítás: új nap (és opcionálisan új határidő). Alapból a
-- határidő az új nap hetének vasárnapja. Már beadott feladat nem mozgatható.
create or replace function public.reschedule_student_task(
  p_student_task_id uuid, p_date date, p_due_date date default null)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_due date := coalesce(p_due_date, _sunday_of_week(p_date));
begin
  perform _assert_teacher();
  if extract(isodow from p_date) = 7 then
    raise exception 'sunday_not_allowed' using errcode = 'P0001';
  end if;
  if v_due < p_date then
    raise exception 'due_before_date' using errcode = 'P0001';
  end if;

  update student_tasks
     set scheduled_date = p_date, due_date = v_due, updated_at = now()
   where id = p_student_task_id and status in ('not_started', 'needs_revision');
  if not found then
    raise exception 'not_reschedulable' using errcode = 'P0001';
  end if;
end $$;

-- Tanulónkénti módosítás: feladatcsere. Csak beadás előtt.
create or replace function public.swap_student_task(p_student_task_id uuid, p_task_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  if not exists (select 1 from tasks where id = p_task_id and archived_at is null) then
    raise exception 'task_not_available' using errcode = 'P0001';
  end if;

  update student_tasks st
     set task_id = p_task_id, updated_at = now()
   where st.id = p_student_task_id
     and st.status = 'not_started'
     and not exists (select 1 from submissions s where s.student_task_id = st.id);
  if not found then
    raise exception 'not_swappable' using errcode = 'P0001';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Tömeges import
-- -----------------------------------------------------------------------------

-- A szerver már validált sorokat küld; az adatbázis atomikusan szúr be:
-- vagy minden sor bekerül, vagy egy sem. Elvárt elemek:
--   { title, body_md, topic_slug, difficulty, requires_image, figure_path?, solution_md? }
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

    insert into tasks (title, body_md, topic_id, difficulty, requires_image, figure_path)
    values (btrim(v_row ->> 'title'), v_row ->> 'body_md', v_topic,
            (v_row ->> 'difficulty')::smallint,
            coalesce((v_row ->> 'requires_image')::boolean, true),
            nullif(v_row ->> 'figure_path', ''))
    returning id into v_task;

    if nullif(btrim(coalesce(v_row ->> 'solution_md', '')), '') is not null then
      insert into task_solutions (task_id, solution_md) values (v_task, v_row ->> 'solution_md');
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Jogosultságok
-- -----------------------------------------------------------------------------

revoke execute on function
  public._sunday_of_week(date),
  public.add_worksheet_item(uuid, uuid),
  public.move_worksheet_item(uuid, int),
  public.duplicate_worksheet(uuid, boolean, text),
  public.assign_worksheet(uuid, date, uuid[]),
  public.reschedule_student_task(uuid, date, date),
  public.swap_student_task(uuid, uuid),
  public.import_tasks(jsonb)
from public, anon, authenticated;

grant execute on function
  public.add_worksheet_item(uuid, uuid),
  public.move_worksheet_item(uuid, int),
  public.duplicate_worksheet(uuid, boolean, text),
  public.assign_worksheet(uuid, date, uuid[]),
  public.reschedule_student_task(uuid, date, date),
  public.swap_student_task(uuid, uuid),
  public.import_tasks(jsonb)
to authenticated;
