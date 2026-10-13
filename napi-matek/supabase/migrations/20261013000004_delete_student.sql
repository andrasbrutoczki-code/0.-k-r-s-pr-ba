-- =============================================================================
-- Tanuló végleges törlése (GDPR: a törléshez való jog)
--
-- Csak LETILTOTT tanuló törölhető: a letiltás az első, visszafordítható lépés,
-- a törlés a második, végleges. Így egy elkattintás nem visz el adatot.
--
-- A teljes törlés három rétegben történik (a szerver végzi, ebben a sorrendben):
--   1. a tanuló fájljai a Storage-ból (a `submissions` bucket {student_id}/ mappája),
--   2. delete_student(): az app_users sor törlése, ami kaszkádolva viszi a
--      students, student_credentials, student_sessions, student_tasks,
--      submissions, submission_images és messages sorokat,
--   3. az Auth felhasználó törlése (admin API).
-- =============================================================================

create or replace function public.delete_student(p_student_id uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_disabled timestamptz;
begin
  perform _assert_teacher();

  select disabled_at into v_disabled from students where id = p_student_id;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;
  if v_disabled is null then
    raise exception 'student_not_disabled' using errcode = 'P0001',
      hint = 'Törlés előtt tiltsd le a tanulót.';
  end if;

  perform _revoke_all_student_sessions(p_student_id);
  -- Előbb a feladatok (kaszkád: beadások, képhivatkozások, üzenetszálak), mert a
  -- messages.author_id idegen kulcs az app_users sorra mutat; egy menetben a
  -- kaszkádok sorrendje miatt a kulcsellenőrzés elbukna.
  delete from student_tasks where student_id = p_student_id;
  delete from app_users where user_id = p_student_id and role = 'student';
end $$;

revoke execute on function public.delete_student(uuid) from public, anon, authenticated;
grant execute on function public.delete_student(uuid) to authenticated;
