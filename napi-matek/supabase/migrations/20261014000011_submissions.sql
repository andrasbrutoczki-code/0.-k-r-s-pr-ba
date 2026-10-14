-- =============================================================================
-- 3. lépés: beadás feladattípusonként
--
--   teszt     – választott betűjel (A–F) + rövid szöveges indoklás; kép nem kell
--   rovid     – az eredmény szövegesen
--   kifejtos  – fénykép(ek); a „requires_image” jelölő dönti el, kötelező-e kép
--
-- A beadás egy verzió (submissions sor). A képek a vázlathoz (submitted_at NULL)
-- töltődnek fel közvetlenül a böngészőből; a „Kész” gomb (submit_task) zárja le
-- a vázlatot, és innentől a verzió megváltoztathatatlan. Javítandó feladatnál új
-- verzió készül, a régiek megmaradnak.
-- =============================================================================

alter table public.submissions
  add column choice text check (choice ~ '^[A-F]$'),
  add column answer_text text check (char_length(answer_text) <= 5000);

-- A tanuló saját, beadható feladatának vázlata (ha nincs, létrehozza).
create or replace function public.get_or_create_draft(p_student_task_id uuid)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  v_me uuid := current_student_id();
  v_task student_tasks;
  v_draft uuid;
begin
  if v_me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_task from student_tasks
   where id = p_student_task_id and student_id = v_me
   for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0002';
  end if;
  if v_task.scheduled_date > today_bp() then
    raise exception 'not_yet_available' using errcode = 'P0001';
  end if;
  if v_task.status not in ('not_started', 'needs_revision') then
    raise exception 'not_submittable' using errcode = 'P0001';
  end if;

  select id into v_draft from submissions
   where student_task_id = v_task.id and submitted_at is null;
  if v_draft is null then
    insert into submissions (student_task_id, version)
    values (v_task.id,
            coalesce((select max(version) from submissions where student_task_id = v_task.id), 0) + 1)
    returning id into v_draft;
  end if;
  return v_draft;
end $$;

-- Beadás (a „Kész” pipa). Visszaad egy véletlen biztató üzenetet.
create or replace function public.submit_task(
  p_student_task_id uuid, p_choice text default null, p_answer_text text default null)
returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_me uuid := current_student_id();
  v_task student_tasks;
  v_type task_type;
  v_requires_image boolean;
  v_choice text := nullif(upper(btrim(coalesce(p_choice, ''))), '');
  v_answer text := nullif(btrim(coalesce(p_answer_text, '')), '');
  v_draft uuid;
  v_message text;
begin
  -- A vázlatot ugyanazokkal az ellenőrzésekkel kérjük le / hozzuk létre.
  v_draft := get_or_create_draft(p_student_task_id);
  select * into v_task from student_tasks where id = p_student_task_id;
  select task_type, requires_image into v_type, v_requires_image from tasks where id = v_task.task_id;

  if v_type = 'teszt' then
    if v_choice is null or v_choice !~ '^[A-F]$' then
      raise exception 'choice_required' using errcode = 'P0001';
    end if;
    if v_answer is null or char_length(v_answer) < 3 then
      raise exception 'reasoning_required' using errcode = 'P0001';
    end if;
  elsif v_type = 'rovid' and v_answer is null then
    raise exception 'answer_required' using errcode = 'P0001';
  end if;
  if char_length(coalesce(v_answer, '')) > 5000 then
    raise exception 'answer_too_long' using errcode = 'P0001';
  end if;
  if v_requires_image and not exists (select 1 from submission_images where submission_id = v_draft) then
    raise exception 'image_required' using errcode = 'P0001';
  end if;

  update submissions
     set submitted_at = now(),
         choice = case when v_type = 'teszt' then v_choice end,
         answer_text = v_answer
   where id = v_draft;

  update student_tasks
     set status = 'submitted',
         first_submitted_at = coalesce(first_submitted_at, now()),
         last_submitted_at = now(),
         is_late = now() > end_of_day_bp(due_date),
         updated_at = now()
   where id = v_task.id;

  select text into v_message from encouragements where active order by random() limit 1;
  return coalesce(v_message, 'Szép munka!');
end $$;

revoke execute on function public.get_or_create_draft(uuid), public.submit_task(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.get_or_create_draft(uuid), public.submit_task(uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: a tanuló csak beadható feladatához tölthet fel, és beadott verzió
-- fájlját nem törölheti (a tanár mindig látja, amit beadott).
-- -----------------------------------------------------------------------------
drop policy if exists sub_student_rw on storage.objects;

create policy sub_student_read on storage.objects for select to authenticated
  using (bucket_id = 'submissions'
         and (storage.foldername(name))[1] = public.current_student_id()::text);

create policy sub_student_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions'
              and (storage.foldername(name))[1] = public.current_student_id()::text
              and exists (
                select 1 from public.student_tasks st
                 where st.id::text = (storage.foldername(name))[2]
                   and st.student_id = public.current_student_id()
                   and st.status in ('not_started', 'needs_revision')));

create policy sub_student_delete on storage.objects for delete to authenticated
  using (bucket_id = 'submissions'
         and (storage.foldername(name))[1] = public.current_student_id()::text
         and not exists (
           select 1 from public.submission_images si
             join public.submissions s on s.id = si.submission_id
            where si.storage_path = storage.objects.name and s.submitted_at is not null));
