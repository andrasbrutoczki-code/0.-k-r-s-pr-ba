-- Hétgenerátor: nagy feladatbanknál (1000+ jelölt) is egyenletes választék.
create or replace function public.generator_pool(
  p_worksheet_id uuid,
  p_topic_ids smallint[],
  p_types public.task_type[],
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
     and t.difficulty between p_difficulty_min and p_difficulty_max
     and not exists (select 1 from worksheet_items wi
                      where wi.worksheet_id = p_worksheet_id and wi.task_id = t.id)
     and (not p_only_unassigned
          or not exists (select 1 from student_tasks st where st.task_id = t.id))
   -- Véletlen sorrend: ha 1000-nél több a jelölt, a PostgREST sorlimitje
   -- miatt levágott rész se torzítsa a választékot (pl. mindig az elejét).
   order by random();
end $$;
