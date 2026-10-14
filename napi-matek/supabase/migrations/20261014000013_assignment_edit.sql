-- =============================================================================
-- Hibás kiosztás javítása: visszavonás, áthelyezés, tanuló hozzáadása
--
-- Biztonsági szabály: csak „érintetlen” feladat törölhető – amelyet a tanuló
-- még nem adott be, nem kezdett el (nincs vázlata/feltöltött képe), és amelyhez
-- nem tartozik üzenet. Ami már munka, az megmarad, és a válasz jelzi.
-- =============================================================================

create or replace function public._is_untouched(p_student_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select st.status = 'not_started'
     and not exists (select 1 from submissions s where s.student_task_id = st.id)
     and not exists (select 1 from messages m where m.student_task_id = st.id)
    from student_tasks st where st.id = p_student_task_id
$$;

-- Kiosztás visszavonása (egész kiosztás, vagy csak egy tanulónál).
-- Visszaadja: { "removed": n, "kept": m, "assignment_deleted": bool }
create or replace function public.revoke_assignment(p_assignment_id uuid, p_student_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_removed int;
  v_kept int;
  v_deleted boolean := false;
begin
  perform _assert_teacher();
  if not exists (select 1 from assignments where id = p_assignment_id) then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  with gone as (
    delete from student_tasks st
     where st.assignment_id = p_assignment_id
       and (p_student_id is null or st.student_id = p_student_id)
       and _is_untouched(st.id)
    returning 1
  ) select count(*) into v_removed from gone;

  select count(*) into v_kept from student_tasks
   where assignment_id = p_assignment_id and (p_student_id is null or student_id = p_student_id);

  if not exists (select 1 from student_tasks where assignment_id = p_assignment_id) then
    delete from assignments where id = p_assignment_id;
    v_deleted := true;
  end if;

  return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'assignment_deleted', v_deleted);
end $$;

-- Egyetlen kiosztott feladat eltávolítása (csak érintetlen).
create or replace function public.remove_student_task(p_student_task_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_assignment uuid;
begin
  perform _assert_teacher();
  select assignment_id into v_assignment from student_tasks where id = p_student_task_id;
  if v_assignment is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if not _is_untouched(p_student_task_id) then
    raise exception 'task_in_use' using errcode = 'P0001';
  end if;
  delete from student_tasks where id = p_student_task_id;
  if not exists (select 1 from student_tasks where assignment_id = v_assignment) then
    delete from assignments where id = v_assignment;
  end if;
end $$;

-- Teljes kiosztás áthelyezése új kezdőnapra: az el nem kezdett feladatok dátumát
-- a munkalap ütemezéséből újraszámolja (a már beadottakat nem mozgatja).
create or replace function public.move_assignment(p_assignment_id uuid, p_start_date date)
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_count int;
begin
  perform _assert_teacher();
  if p_start_date is null then
    raise exception 'start_missing' using errcode = 'P0001';
  end if;
  update assignments set start_date = p_start_date where id = p_assignment_id;
  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  with moved as (
    update student_tasks st
       set scheduled_date = x.d, due_date = _sunday_of_week(x.d), updated_at = now()
      from worksheet_items wi,
           lateral (select _add_school_days(p_start_date, 5 * (wi.week_no - 1) + (wi.day_no - 1)) as d) x
     where st.assignment_id = p_assignment_id
       and st.worksheet_item_id = wi.id
       and st.status = 'not_started'
    returning 1
  ) select count(*) into v_count from moved;
  return v_count;
end $$;

-- Tanuló(k) hozzáadása egy meglévő kiosztáshoz, ugyanazzal a kezdőnappal.
-- Aki már szerepel a kiosztásban, azt kihagyja.
create or replace function public.add_students_to_assignment(p_assignment_id uuid, p_student_ids uuid[])
returns int
language plpgsql security definer
set search_path = public as $$
declare
  v_assignment assignments;
  v_count int;
begin
  perform _assert_teacher();
  select * into v_assignment from assignments where id = p_assignment_id;
  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_student_ids), 0) = 0 then
    raise exception 'no_students' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_student_ids) as sid
     where not exists (select 1 from students s where s.id = sid and s.disabled_at is null)) then
    raise exception 'invalid_student' using errcode = 'P0001';
  end if;

  with added as (
    insert into student_tasks
      (assignment_id, student_id, task_id, worksheet_item_id, position, scheduled_date, due_date)
    select p_assignment_id, s.sid, wi.task_id, wi.id, wi.position, x.d, _sunday_of_week(x.d)
      from (select distinct unnest(p_student_ids) as sid) s
     cross join worksheet_items wi
     cross join lateral (
       select _add_school_days(v_assignment.start_date, 5 * (wi.week_no - 1) + (wi.day_no - 1)) as d
     ) x
     where wi.worksheet_id = v_assignment.worksheet_id
       and not exists (select 1 from student_tasks e
                        where e.assignment_id = p_assignment_id and e.student_id = s.sid)
    returning 1
  ) select count(*) into v_count from added;
  return v_count;
end $$;

revoke execute on function
  public._is_untouched(uuid), public.revoke_assignment(uuid, uuid), public.remove_student_task(uuid),
  public.move_assignment(uuid, date), public.add_students_to_assignment(uuid, uuid[])
from public, anon, authenticated;
grant execute on function
  public.revoke_assignment(uuid, uuid), public.remove_student_task(uuid),
  public.move_assignment(uuid, date), public.add_students_to_assignment(uuid, uuid[])
to authenticated;
