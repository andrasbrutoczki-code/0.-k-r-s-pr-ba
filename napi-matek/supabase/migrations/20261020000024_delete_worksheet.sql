-- =============================================================================
-- Munkalap törlése akkor is, ha már ki van osztva
--
-- A törlés előtt minden kiosztását visszavonjuk (a még el nem kezdett
-- feladatok törlődnek). Ami már munka (beadás, vázlat, üzenet), az megmarad:
-- a kiosztás a munkalap nélkül, a címe másolatával él tovább.
-- =============================================================================

alter table public.assignments alter column worksheet_id drop not null;
alter table public.assignments add column worksheet_title text;

create or replace function public.delete_worksheet(p_worksheet_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public as $$
declare
  v_title text;
  v_assignment uuid;
  v_result jsonb;
  v_removed int := 0;
  v_kept int := 0;
begin
  perform _assert_teacher();
  select title into v_title from worksheets where id = p_worksheet_id;
  if v_title is null then
    raise exception 'worksheet_not_found' using errcode = 'P0002';
  end if;

  for v_assignment in select id from assignments where worksheet_id = p_worksheet_id loop
    v_result := revoke_assignment(v_assignment, null);
    v_removed := v_removed + (v_result ->> 'removed')::int;
    v_kept := v_kept + (v_result ->> 'kept')::int;
  end loop;

  -- A megmaradt (munkát tartalmazó) kiosztások leválnak a munkalapról.
  update assignments set worksheet_title = v_title, worksheet_id = null where worksheet_id = p_worksheet_id;
  delete from worksheets where id = p_worksheet_id;

  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end $$;

revoke execute on function public.delete_worksheet(uuid) from public, anon, authenticated;
grant execute on function public.delete_worksheet(uuid) to authenticated;
