-- =============================================================================
-- A szombat pótlónap: új feladat nem kerül rá
--
-- Feladatok csak hétfőtől péntekig ütemezhetők a munkalapon (nap 1–5).
-- Szombaton a tanuló a hét elmaradt feladatait pótolja; a szombat akkor
-- számít a sorozatba, ha szombat végéig a hét minden feladata be van adva.
--
-- Ütemezés a kezdőnaptól: a k-adik tanítási nap k = 5·(hét−1) + (nap−1),
-- a hétvégéket átugorva. Hétvégi kezdőnapnál az első feladat a következő hétfő.
-- =============================================================================

-- Az adatbázis a régi 6-os (szombati) napot még elfogadja, mert korábbi munkalapokon
-- lehet ilyen tétel; új tétel csak 1–5 lehet (ezt az alkalmazás és az RPC-k biztosítják).
-- Egy esetleges 6-os tétel kiosztáskor a következő hét hétfőjére esik.

alter table public.assignments drop constraint if exists assignments_start_not_sunday;

-- d + n tanítási nap (H–P). Hétvégi d esetén a következő hétfőtől számol.
create or replace function public._add_school_days(d date, n int) returns date
language sql immutable set search_path = '' as $$
  with base as (
    select case extract(isodow from d)::int when 6 then d + 2 when 7 then d + 1 else d end as b
  )
  select (b - (extract(isodow from b)::int - 1))
         + 7 * ((extract(isodow from b)::int - 1 + n) / 5)
         + ((extract(isodow from b)::int - 1 + n) % 5)
    from base
$$;
revoke execute on function public._add_school_days(date, int) from public, anon, authenticated;

-- Új tétel: péntek után a következő hét hétfője.
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
    if v_last.day_no >= 5 then
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

create or replace function public.assign_worksheet(
  p_worksheet_id uuid, p_start_date date, p_student_ids uuid[])
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_assignment uuid;
begin
  perform _assert_teacher();

  if p_start_date is null then
    raise exception 'start_missing' using errcode = 'P0001';
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
     select _add_school_days(p_start_date, 5 * (wi.week_no - 1) + (wi.day_no - 1)) as d
   ) x
   where wi.worksheet_id = p_worksheet_id;

  return v_assignment;
end $$;

-- A korábbi _add_practice_days már nincs használatban; nem töröljük, hogy a régi
-- kiosztások visszakövethetők maradjanak.
