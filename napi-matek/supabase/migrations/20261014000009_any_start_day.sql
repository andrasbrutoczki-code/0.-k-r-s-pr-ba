-- =============================================================================
-- Kiosztás bármely napon indulhat (vasárnap kivételével)
--
-- A munkalap tételei (hét, nap) sorrendet jelölnek: a k-adik gyakorlási nap
-- k = 6·(hét−1) + (nap−1). Az 1. hét hétfője a kezdőnapra esik, a többi tétel
-- ehhez képest annyi GYAKORLÁSI nappal (H–Szo) később, a vasárnapokat átugorva.
-- Hétfői kezdésnél ez pontosan a korábbi ütemezés; pl. szerdai kezdésnél
-- 1/1 = szerda, 1/4 = szombat, 1/5 = a következő hétfő.
-- A határidő mindig az ütemezett nap hetének vasárnapja.
-- =============================================================================

alter table public.assignments drop constraint if exists assignments_start_date_check;
alter table public.assignments
  add constraint assignments_start_not_sunday check (extract(isodow from start_date) <> 7);

-- d + n gyakorlási nap (vasárnapok nélkül). d nem lehet vasárnap.
create or replace function public._add_practice_days(d date, n int) returns date
language sql immutable set search_path = '' as $$
  select (d - (extract(isodow from d)::int - 1))                       -- d hetének hétfője
         + 7 * ((extract(isodow from d)::int - 1 + n) / 6)             -- teljes hetek
         + ((extract(isodow from d)::int - 1 + n) % 6)                 -- nap a héten belül
$$;

create or replace function public.assign_worksheet(
  p_worksheet_id uuid, p_start_date date, p_student_ids uuid[])
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_assignment uuid;
begin
  perform _assert_teacher();

  if p_start_date is null or extract(isodow from p_start_date) = 7 then
    raise exception 'start_is_sunday' using errcode = 'P0001';
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
  select v_assignment, s.sid, wi.task_id, wi.id, wi.position, x.d, _sunday_of_week(x.d)
    from (select distinct unnest(p_student_ids) as sid) s
   cross join worksheet_items wi
   cross join lateral (
     select _add_practice_days(p_start_date, 6 * (wi.week_no - 1) + (wi.day_no - 1)) as d
   ) x
   where wi.worksheet_id = p_worksheet_id;

  return v_assignment;
end $$;

revoke execute on function public._add_practice_days(date, int) from public, anon, authenticated;
