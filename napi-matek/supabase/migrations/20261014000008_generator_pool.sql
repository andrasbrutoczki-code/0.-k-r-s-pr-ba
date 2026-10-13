-- =============================================================================
-- Hétgenerátor: a választható feladatok halmaza egy lekérdezésben.
-- A kizárásokat (már a munkalapon / már kiosztva) az adatbázis végzi, így
-- nem kell az összes kiosztást a szerverre tölteni (a PostgREST soronkénti
-- korlátja sem csonkíthatja a kizárási listát).
-- =============================================================================

create or replace function public.generator_pool(
  p_worksheet_id uuid,
  p_topic_ids smallint[],
  p_types public.task_type[],
  p_difficulty_min smallint,
  p_difficulty_max smallint,
  p_only_unassigned boolean)
returns table (id uuid, title text, topic_id smallint, difficulty smallint,
               task_type public.task_type, est_minutes smallint)
language plpgsql stable security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  return query
  select t.id, t.title, t.topic_id, t.difficulty, t.task_type, t.est_minutes
    from tasks t
   where t.archived_at is null
     and t.topic_id = any (p_topic_ids)
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
