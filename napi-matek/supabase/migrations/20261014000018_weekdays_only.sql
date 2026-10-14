-- =============================================================================
-- Szombat = pótlónap: feladat csak hétfőtől péntekig ütemezhető
-- (A régi szombati tételeket előtte hétköznapra soroltuk; ez adatmódosítás volt.)
-- =============================================================================

alter table public.worksheet_items
  add constraint worksheet_items_day_weekday check (day_no between 1 and 5) not valid;
alter table public.worksheet_items validate constraint worksheet_items_day_weekday;

-- Egyedi áthelyezés: szombatra és vasárnapra sem.
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
  if extract(isodow from p_date) = 6 then
    raise exception 'saturday_not_allowed' using errcode = 'P0001';
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
