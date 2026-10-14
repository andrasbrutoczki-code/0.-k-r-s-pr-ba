-- =============================================================================
-- 4. lépés: tanári ellenőrzés
--
-- Állapotgép (tanári oldal):
--   submitted ──megnyitás──▶ in_review
--   submitted / in_review ──üzenet döntés nélkül──▶ feedback_given
--   bármelyik ──döntés──▶ accepted | needs_revision
--   accepted ──visszanyitás──▶ in_review
-- A tanuló új beadása (needs_revision után) ismét submitted.
-- =============================================================================

-- Megnyitáskor: Beadva → Javítás alatt. Más állapotot nem változtat.
create or replace function public.open_for_review(p_student_task_id uuid)
returns public.task_status
language plpgsql security definer
set search_path = public as $$
declare
  v_status task_status;
begin
  perform _assert_teacher();
  update student_tasks set status = 'in_review', updated_at = now()
   where id = p_student_task_id and status = 'submitted';
  select status into v_status from student_tasks where id = p_student_task_id;
  if v_status is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  return v_status;
end $$;

-- Tanári üzenet a szálban. Döntés nélkül: Beadva / Javítás alatt → Visszajelzés érkezett.
create or replace function public.teacher_message(p_student_task_id uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  perform _assert_teacher();
  if v_body = '' then
    raise exception 'message_empty' using errcode = 'P0001';
  end if;
  if not exists (select 1 from student_tasks where id = p_student_task_id) then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;

  insert into messages (student_task_id, author_id, body_md)
  values (p_student_task_id, auth.uid(), v_body)
  returning id into v_id;

  update student_tasks set status = 'feedback_given', updated_at = now()
   where id = p_student_task_id and status in ('submitted', 'in_review');
  return v_id;
end $$;

-- Döntés: Elfogadva vagy Javítandó, opcionális üzenettel (egy tranzakcióban).
create or replace function public.set_review_decision(
  p_student_task_id uuid, p_status public.task_status, p_message text default null)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_current task_status;
begin
  perform _assert_teacher();
  if p_status not in ('accepted', 'needs_revision') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  select status into v_current from student_tasks where id = p_student_task_id for update;
  if v_current is null then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_current = 'not_started' then
    raise exception 'nothing_submitted' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_message, '')), '') is not null then
    insert into messages (student_task_id, author_id, body_md)
    values (p_student_task_id, auth.uid(), btrim(p_message));
  end if;

  update student_tasks set status = p_status, updated_at = now() where id = p_student_task_id;
end $$;

-- Elfogadott feladat visszanyitása (Javítás alatt).
create or replace function public.reopen_review(p_student_task_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform _assert_teacher();
  update student_tasks set status = 'in_review', updated_at = now()
   where id = p_student_task_id and status = 'accepted';
  if not found then
    raise exception 'not_reopenable' using errcode = 'P0001';
  end if;
end $$;

-- Olvasottnak jelöli a szál másik fél által írt üzeneteit (tanár és tanuló is hívhatja).
create or replace function public.mark_thread_read(p_student_task_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  if is_teacher() then
    update messages m set read_at = now()
      from student_tasks st
     where m.student_task_id = p_student_task_id and st.id = m.student_task_id
       and m.author_id = st.student_id and m.read_at is null;
  elsif current_student_id() is not null then
    update messages m set read_at = now()
      from student_tasks st
     where m.student_task_id = p_student_task_id and st.id = m.student_task_id
       and st.student_id = current_student_id()
       and m.author_id <> st.student_id and m.read_at is null;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- A tanári menü jelvénye: ellenőrzésre váró beadások és olvasatlan tanulói üzenetek.
create or replace function public.review_counts()
returns table (to_review int, unread_messages int)
language sql stable security definer
set search_path = public as $$
  select
    (select count(*)::int from student_tasks where status = 'submitted'),
    (select count(*)::int from messages m join student_tasks st on st.id = m.student_task_id
      where m.author_id = st.student_id and m.read_at is null)
  where is_teacher()
$$;

create index if not exists student_tasks_status_idx on public.student_tasks (status, last_submitted_at);
create index if not exists messages_unread_idx on public.messages (student_task_id) where read_at is null;

revoke execute on function
  public.open_for_review(uuid), public.teacher_message(uuid, text),
  public.set_review_decision(uuid, public.task_status, text), public.reopen_review(uuid),
  public.mark_thread_read(uuid), public.review_counts()
from public, anon, authenticated;
grant execute on function
  public.open_for_review(uuid), public.teacher_message(uuid, text),
  public.set_review_decision(uuid, public.task_status, text), public.reopen_review(uuid),
  public.mark_thread_read(uuid), public.review_counts()
to authenticated;
