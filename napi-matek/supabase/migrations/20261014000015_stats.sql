-- =============================================================================
-- Statisztika: napi és heti összesítők a sorozathoz (streak), témakörönkénti adatok
--
-- Mindhárom függvény SECURITY INVOKER: a hívó jogosultságával, RLS alatt fut,
-- így a tanuló csak a saját adatait kapja vissza, a tanár mindenkiét.
-- A sorozat kiszámítása (src/lib/stats/streak.ts) ezekből az összesítőkből
-- dolgozik, így a PostgREST sorlimitje sem gond, akárhány feladat van.
-- =============================================================================

-- Naponként: hány feladat volt ütemezve (ma bezárólag), és hány beadás történt
-- (budapesti naptári nap szerint; az újrabeadás is beadás).
create or replace function public.stats_daily(p_student_id uuid default null)
returns table (student_id uuid, day date, scheduled int, submitted int)
language sql stable security invoker
set search_path = public as $$
  with sched as (
    select st.student_id, st.scheduled_date as day, count(*)::int as n
      from student_tasks st
     where (p_student_id is null or st.student_id = p_student_id)
       and st.scheduled_date <= today_bp()
     group by 1, 2
  ), subm as (
    select st.student_id, (s.submitted_at at time zone 'Europe/Budapest')::date as day, count(*)::int as n
      from submissions s
      join student_tasks st on st.id = s.student_task_id
     where s.submitted_at is not null
       and (p_student_id is null or st.student_id = p_student_id)
     group by 1, 2
  )
  select coalesce(a.student_id, b.student_id), coalesce(a.day, b.day), coalesce(a.n, 0), coalesce(b.n, 0)
    from sched a
    full join subm b on b.student_id = a.student_id and b.day = a.day
   order by 1, 2
$$;

-- Hetenként (hétfőtől): hány feladat volt a héten, és ebből hány volt beadva
-- a hét szombatjának végéig – a szombat ettől számít a sorozatba.
create or replace function public.stats_weekly(p_student_id uuid default null)
returns table (student_id uuid, week_start date, total int, done_by_saturday int)
language sql stable security invoker
set search_path = public as $$
  select st.student_id,
         date_trunc('week', st.scheduled_date)::date,
         count(*)::int,
         count(*) filter (
           where st.first_submitted_at is not null
             and (st.first_submitted_at at time zone 'Europe/Budapest')::date
                 <= date_trunc('week', st.scheduled_date)::date + 5
         )::int
    from student_tasks st
   where (p_student_id is null or st.student_id = p_student_id)
     and date_trunc('week', st.scheduled_date)::date <= today_bp()
   group by 1, 2
   order by 1, 2
$$;

-- Témakörönként (ma bezárólag kiosztott feladatok). A tesztpontosság a helyes
-- választ igényli, ami csak a tanárnak látható: a tanulónál ezek 0-k.
create or replace function public.stats_topics(p_student_id uuid default null)
returns table (
  student_id uuid, topic_id smallint, topic_name text,
  assigned int, submitted int, accepted int, needs_revision int, late int,
  test_checked int, test_correct int)
language sql stable security invoker
set search_path = public as $$
  select st.student_id, tp.id, tp.name,
         count(*)::int,
         count(*) filter (where st.first_submitted_at is not null)::int,
         count(*) filter (where st.status = 'accepted')::int,
         count(*) filter (where st.status = 'needs_revision')::int,
         count(*) filter (where st.is_late)::int,
         count(*) filter (where t.task_type = 'teszt' and sol.correct_choice is not null and latest.choice is not null)::int,
         count(*) filter (where t.task_type = 'teszt' and latest.choice = sol.correct_choice)::int
    from student_tasks st
    join tasks t on t.id = st.task_id
    join topics tp on tp.id = t.topic_id
    left join task_solutions sol on sol.task_id = t.id
    left join lateral (
      select s.choice from submissions s
       where s.student_task_id = st.id and s.submitted_at is not null
       order by s.version desc limit 1
    ) latest on true
   where (p_student_id is null or st.student_id = p_student_id)
     and st.scheduled_date <= today_bp()
   group by st.student_id, tp.id, tp.name
   order by st.student_id, tp.id
$$;

revoke execute on function public.stats_daily(uuid), public.stats_weekly(uuid), public.stats_topics(uuid)
  from public, anon;
grant execute on function public.stats_daily(uuid), public.stats_weekly(uuid), public.stats_topics(uuid)
  to authenticated;
