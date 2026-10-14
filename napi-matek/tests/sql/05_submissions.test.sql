-- =============================================================================
-- 3. lépés: beadás típusonként, verziók, láthatóság, tanulók elkülönítése
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 's-b@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
select create_student('00000000-0000-0000-0000-0000000000a2', 'Bence');
select import_tasks('[
  {"title":"Teszt","body_md":"?\n(A) 1\n(B) 2\n(C) 3\n(D) 4","topic_slug":"algebra","difficulty":1,"requires_image":false,"task_type":"teszt"},
  {"title":"Rövid","body_md":"x=?","topic_slug":"algebra","difficulty":1,"requires_image":false,"task_type":"rovid"},
  {"title":"Kifejtős","body_md":"Igazolja!","topic_slug":"algebra","difficulty":2,"requires_image":true,"task_type":"kifejtos"},
  {"title":"Holnapi","body_md":"később","topic_slug":"algebra","difficulty":1,"requires_image":false,"task_type":"rovid"}
]'::jsonb);
with w as (insert into worksheets (title) values ('Beadás') returning id) insert into ids select 'ws', id from w;
reset role;
-- A tételeket közvetlenül szúrjuk be, hogy mind a mai napra essen (a 4. holnapra).
insert into worksheet_items (worksheet_id, task_id, position, week_no, day_no)
select (select v from ids where k = 'ws'), t.id, row_number() over (order by t.title), 1, 1
  from tasks t where t.title in ('Teszt', 'Rövid', 'Kifejtős');
insert into assignments (id, worksheet_id, start_date)
values ('44444444-0000-0000-0000-000000000001', (select v from ids where k = 'ws'), today_bp());
insert into student_tasks (assignment_id, student_id, task_id, position, scheduled_date, due_date)
select '44444444-0000-0000-0000-000000000001', s.id, t.id, 1,
       case when t.title = 'Holnapi' then today_bp() + 1 else today_bp() end, today_bp() + 7
  from students s cross join tasks t where t.title in ('Teszt', 'Rövid', 'Kifejtős', 'Holnapi');
insert into ids select 'a_' || t.title, st.id from student_tasks st join tasks t on t.id = st.task_id
 where st.student_id = '00000000-0000-0000-0000-0000000000a1';
insert into ids select 'b_' || t.title, st.id from student_tasks st join tasks t on t.id = st.task_id
 where st.student_id = '00000000-0000-0000-0000-0000000000a2';
insert into auth.sessions (id, user_id) values
  ('11111111-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1'),
  ('11111111-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2');
set local role service_role;
select register_student_session('11111111-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 1, 't');
select register_student_session('11111111-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', 1, 't');
reset role;

-- Anna -------------------------------------------------------------------------
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');

select _t((select count(*) from student_tasks) = 3, 'a tanuló csak a mai és korábbi feladatait látja (a holnapit nem)');
select _t((select count(*) from tasks) = 3, 'a holnapi feladat szövege sem látható');

-- Teszt: betű és indoklás kötelező.
do $$ begin
  perform submit_task((select v from ids where k = 'a_Teszt'), null, 'mert');
  raise exception 'FAIL: betű nélkül beadható';
exception when raise_exception then
  if sqlerrm <> 'choice_required' then raise; end if;
  raise notice 'ok  - teszt: betűjel nélkül nem adható be';
end $$;
do $$ begin
  perform submit_task((select v from ids where k = 'a_Teszt'), 'b', '');
  raise exception 'FAIL: indoklás nélkül beadható';
exception when raise_exception then
  if sqlerrm <> 'reasoning_required' then raise; end if;
  raise notice 'ok  - teszt: indoklás nélkül nem adható be';
end $$;
select _t(length(submit_task((select v from ids where k = 'a_Teszt'), 'b', 'Mert 2 páros.')) > 0,
          'teszt beadva, biztató üzenet érkezett');
select _t((select choice = 'B' and answer_text = 'Mert 2 páros.' and submitted_at is not null
             from submissions where student_task_id = (select v from ids where k = 'a_Teszt')),
          'a választott betű nagybetűvel és az indoklás mentve');
select _t((select status = 'submitted' and first_submitted_at is not null and not is_late
             from student_tasks where id = (select v from ids where k = 'a_Teszt')),
          'állapot: Beadva (tanárnál: Ellenőrzésre vár), nem késett');
do $$ begin
  perform submit_task((select v from ids where k = 'a_Teszt'), 'C', 'újra');
  raise exception 'FAIL: kétszer beadható';
exception when raise_exception then
  if sqlerrm <> 'not_submittable' then raise; end if;
  raise notice 'ok  - beadott feladat nem adható be újra, amíg a tanár nem kér javítást';
end $$;

-- Rövid válasz: szöveg kell.
do $$ begin
  perform submit_task((select v from ids where k = 'a_Rövid'), null, '  ');
  raise exception 'FAIL: üres válasz';
exception when raise_exception then
  if sqlerrm <> 'answer_required' then raise; end if;
  raise notice 'ok  - rövid válasz: üresen nem adható be';
end $$;
select submit_task((select v from ids where k = 'a_Rövid'), 'A', 'x = 3');
select _t((select choice is null and answer_text = 'x = 3' from submissions
            where student_task_id = (select v from ids where k = 'a_Rövid')),
          'rövid válasz mentve, betűjel nem tárolódik');

-- Kifejtős: kép nélkül nem; képpel igen.
do $$ begin
  perform submit_task((select v from ids where k = 'a_Kifejtős'));
  raise exception 'FAIL: kép nélkül beadható';
exception when raise_exception then
  if sqlerrm <> 'image_required' then raise; end if;
  raise notice 'ok  - kifejtős: kép nélkül nem adható be';
end $$;
insert into ids values ('draft', get_or_create_draft((select v from ids where k = 'a_Kifejtős')));
select _t(get_or_create_draft((select v from ids where k = 'a_Kifejtős')) = (select v from ids where k = 'draft'),
          'a vázlat egyszer jön létre');
insert into submission_images (submission_id, storage_path)
values ((select v from ids where k = 'draft'),
        '00000000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'a_Kifejtős') || '/1.jpg');
select submit_task((select v from ids where k = 'a_Kifejtős'));
select _t((select status = 'submitted' from student_tasks where id = (select v from ids where k = 'a_Kifejtős')),
          'kifejtős képpel beadva');
do $$ begin
  insert into submission_images (submission_id, storage_path)
  values ((select v from ids where k = 'draft'),
          '00000000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'a_Kifejtős') || '/2.jpg');
  raise exception 'FAIL: beadott verzióhoz kép adható';
exception when insufficient_privilege then
  raise notice 'ok  - beadott verzióhoz nem adható kép';
end $$;
delete from submission_images;
select _t((select count(*) from submission_images) = 1, 'a beadott verzió képe nem törölhető (RLS)');

-- Más tanuló feladatához nem fér hozzá.
do $$ begin
  perform get_or_create_draft((select v from ids where k = 'b_Teszt'));
  raise exception 'FAIL: más tanuló feladatához vázlat';
exception when no_data_found then
  raise notice 'ok  - más tanuló feladatához nem készíthető vázlat';
end $$;
reset role;

-- Javítandó → új verzió, a régi megmarad.
update student_tasks set status = 'needs_revision' where id = (select v from ids where k = 'a_Kifejtős');
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');
insert into ids values ('draft2', get_or_create_draft((select v from ids where k = 'a_Kifejtős')));
select _t((select version from submissions where id = (select v from ids where k = 'draft2')) = 2,
          'javítandónál új (2.) verzió készül');
select _t((select count(*) from submissions where student_task_id = (select v from ids where k = 'a_Kifejtős')) = 2,
          'az első verzió megmarad');

-- Bence -------------------------------------------------------------------------
select _login('00000000-0000-0000-0000-0000000000a2', '11111111-0000-0000-0000-0000000000a2');
select _t((select count(*) from submissions) = 0, 'Bence nem látja Anna beadásait');
select _t((select count(*) from submission_images) = 0, 'Bence nem látja Anna képeit');
select _t((select count(*) from student_tasks) = 3, 'Bence csak a saját 3 mai feladatát látja');
reset role;

rollback;
