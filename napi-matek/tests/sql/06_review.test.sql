-- =============================================================================
-- 4. lépés: tanári ellenőrzés – állapotgép, üzenetek, olvasottság, jogosultság
-- =============================================================================
\set ON_ERROR_STOP 1
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'tanar@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 's-a@students.invalid');
insert into app_users (user_id, role) values ('00000000-0000-0000-0000-0000000000a0', 'teacher');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a0');
select create_student('00000000-0000-0000-0000-0000000000a1', 'Anna');
reset role;

with w as (insert into worksheets (title) values ('R') returning id) insert into ids select 'ws', id from w;
insert into assignments (id, worksheet_id, start_date)
values ('44444444-0000-0000-0000-000000000001', (select v from ids where k = 'ws'), today_bp());
insert into student_tasks (id, assignment_id, student_id, task_id, position, scheduled_date, due_date, status)
values ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1', (select id from tasks limit 1), 1, today_bp(), today_bp() + 7, 'submitted');
insert into auth.sessions (id, user_id) values ('11111111-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');
set local role service_role;
select register_student_session('11111111-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 1, 't');
reset role;

-- Tanuló üzen, a tanár jelvényében megjelenik.
set local role authenticated;
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');
insert into messages (student_task_id, author_id, body_md)
values ('55555555-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Nem értem a b) részt.');
do $$ begin
  perform open_for_review('55555555-0000-0000-0000-000000000001');
  raise exception 'FAIL: tanuló megnyithatta ellenőrzésre';
exception when insufficient_privilege then
  raise notice 'ok  - tanuló nem hívhatja az ellenőrzési függvényeket';
end $$;
select _t(not exists (select 1 from review_counts()), 'tanulónak a jelvényszámláló üres');

select _login('00000000-0000-0000-0000-0000000000a0');
select _t((select to_review = 1 and unread_messages = 1 from review_counts()),
          'jelvény: 1 ellenőrzésre váró, 1 olvasatlan üzenet');

-- Megnyitás: Beadva → Javítás alatt; ismételt megnyitás nem változtat.
select _t(open_for_review('55555555-0000-0000-0000-000000000001') = 'in_review', 'megnyitáskor Javítás alatt');
select _t(open_for_review('55555555-0000-0000-0000-000000000001') = 'in_review', 'ismételt megnyitás nem változtat');
select mark_thread_read('55555555-0000-0000-0000-000000000001');
select _t((select unread_messages = 0 from review_counts()), 'megnyitás után az üzenet olvasott');

-- Üzenet döntés nélkül → Visszajelzés érkezett.
select teacher_message('55555555-0000-0000-0000-000000000001', 'Nézd meg újra a $\sin$ értékét!');
select _t((select status = 'feedback_given' from student_tasks where id = '55555555-0000-0000-0000-000000000001'),
          'tanári üzenet döntés nélkül: Visszajelzés érkezett');

-- Javítandó üzenettel.
select set_review_decision('55555555-0000-0000-0000-000000000001', 'needs_revision', 'A b) rész hiányzik.');
select _t((select status = 'needs_revision' from student_tasks where id = '55555555-0000-0000-0000-000000000001'),
          'döntés: Javítandó');
select _t((select count(*) from messages where student_task_id = '55555555-0000-0000-0000-000000000001') = 3,
          'a döntés üzenete a szálba került (időbélyeggel)');

-- Tanuló látja és olvasottnak jelöli a tanári üzeneteket.
select _login('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-0000000000a1');
select _t((select count(*) from messages where author_id = '00000000-0000-0000-0000-0000000000a0') = 2,
          'a tanuló látja a tanári üzeneteket');
select mark_thread_read('55555555-0000-0000-0000-000000000001');
select _t((select bool_and(read_at is not null) from messages where author_id = '00000000-0000-0000-0000-0000000000a0'),
          'a tanuló olvasottnak jelölte a tanári üzeneteket');

-- Elfogadás, visszanyitás.
select _login('00000000-0000-0000-0000-0000000000a0');
select set_review_decision('55555555-0000-0000-0000-000000000001', 'accepted');
select _t((select status = 'accepted' from student_tasks where id = '55555555-0000-0000-0000-000000000001'), 'döntés: Elfogadva');
select reopen_review('55555555-0000-0000-0000-000000000001');
select _t((select status = 'in_review' from student_tasks where id = '55555555-0000-0000-0000-000000000001'),
          'elfogadott feladat visszanyitható');
do $$ begin
  perform set_review_decision('55555555-0000-0000-0000-000000000001', 'submitted');
  raise exception 'FAIL: érvénytelen döntés elfogadva';
exception when raise_exception then
  if sqlerrm <> 'invalid_decision' then raise; end if;
  raise notice 'ok  - csak Elfogadva / Javítandó döntés adható';
end $$;
reset role;

rollback;
