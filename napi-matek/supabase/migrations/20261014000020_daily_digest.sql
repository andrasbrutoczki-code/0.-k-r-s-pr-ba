-- =============================================================================
-- Napi e-mail-összefoglaló a tanárnak (hétfőtől szombatig, reggel 7-kor)
--
-- Működés: a pg_cron óránként kétszer (5 és 6 UTC) meghívja a
-- send_daily_digest() függvényt; az csak akkor küld, ha Budapesten épp 7 óra
-- van (így a nyári/téli időszámítás váltása sem zavarja), és aznap még nem
-- ment ki levél. A levelet a Resend API küldi (pg_net HTTP-kéréssel).
--
-- Beállítás (egyszer, a Supabase SQL Editorban; a kulcs ne kerüljön a repóba):
--   select vault.create_secret('re_…', 'resend_api_key');
-- Nem kötelező: select vault.create_secret('https://…', 'app_url');
-- =============================================================================

-- A bővítmények csak ott jönnek létre, ahol elérhetők (a helyi tesztadatbázisban nem).
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

-- Melyik napon ment már ki levél (dupla küldés ellen). Csak a szerver írja.
create table public.digest_log (
  day        date primary key,
  sent_at    timestamptz not null default now(),
  request_id bigint
);
alter table public.digest_log enable row level security;  -- policy nélkül = zárva

create or replace function public._html(p text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- Az előző tanítási nap (hétfőn a péntek, vasárnap a péntek).
create or replace function public._prev_school_day(d date) returns date
language sql immutable set search_path = '' as $$
  select case extract(isodow from d)::int when 1 then d - 3 when 7 then d - 2 else d - 1 end
$$;

-- A levél tartalma (tárgy + HTML). Külön függvény, hogy tesztelhető legyen.
create or replace function public.daily_digest_content(p_day date, p_app_url text default null)
returns table (subject text, html text, to_review int)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_prev date := _prev_school_day(p_day);
  v_review int;
  v_unread int;
  v_html text := '';
  v_list text;
  v_link text := coalesce(nullif(p_app_url, ''), '');
begin
  select count(*) into v_review
    from student_tasks st join students s on s.id = st.student_id
   where st.status in ('submitted', 'in_review') and s.disabled_at is null;

  select count(*) into v_unread
    from messages m
    join student_tasks st on st.id = m.student_task_id
   where m.read_at is null and m.author_id = st.student_id;

  v_html := v_html || format('<h2 style="margin:0 0 8px">Ellenőrzésre vár: %s</h2>', v_review);
  select string_agg(format('<li>%s – %s <span style="color:#5c6475">(beadva: %s)</span></li>',
                           _html(x.name), _html(x.title), x.at), '')
    into v_list
    from (select s.display_name name, t.title,
                 to_char(st.last_submitted_at at time zone 'Europe/Budapest', 'MM.DD. HH24:MI') at
            from student_tasks st
            join students s on s.id = st.student_id
            join tasks t on t.id = st.task_id
           where st.status in ('submitted', 'in_review') and s.disabled_at is null
           order by st.last_submitted_at nulls last
           limit 10) x;
  if v_list is not null then
    v_html := v_html || '<ul>' || v_list || '</ul>';
    if v_review > 10 then v_html := v_html || format('<p>… és még %s.</p>', v_review - 10); end if;
  end if;

  if v_unread > 0 then
    v_html := v_html || format('<p><strong>Olvasatlan tanulói üzenet:</strong> %s</p>', v_unread);
  end if;

  -- Kimaradt: az előző tanítási napra volt feladata, de aznap semmit nem adott be.
  select string_agg(format('<li>%s – %s feladat</li>', _html(x.name), x.n), '' order by x.name)
    into v_list
    from (select s.display_name name, count(*) n
            from student_tasks st join students s on s.id = st.student_id
           where st.scheduled_date = v_prev and s.disabled_at is null
             and not exists (
               select 1 from submissions sub join student_tasks st2 on st2.id = sub.student_task_id
                where st2.student_id = s.id and sub.submitted_at is not null
                  and (sub.submitted_at at time zone 'Europe/Budapest')::date = v_prev)
           group by s.display_name) x;
  v_html := v_html || format('<h3 style="margin:16px 0 4px">%s – nem adott be semmit</h3>', to_char(v_prev, 'YYYY.MM.DD.'));
  v_html := v_html || coalesce('<ul>' || v_list || '</ul>', '<p>Mindenki beadott valamit.</p>');

  -- Lejárt határidő, még be nem adva.
  select string_agg(format('<li>%s – %s feladat</li>', _html(x.name), x.n), '' order by x.name)
    into v_list
    from (select s.display_name name, count(*) n
            from student_tasks st join students s on s.id = st.student_id
           where st.due_date < p_day and st.first_submitted_at is null and s.disabled_at is null
           group by s.display_name) x;
  if v_list is not null then
    v_html := v_html || '<h3 style="margin:16px 0 4px">Lejárt határidő, nincs beadva</h3><ul>' || v_list || '</ul>';
  end if;

  if v_link <> '' then
    v_html := v_html || format('<p style="margin-top:16px"><a href="%s/tanar/ellenorzes">Megnyitás: Ellenőrzés</a></p>',
                               _html(v_link));
  end if;

  subject := format('Napi matek – %s ellenőrzésre vár (%s)', v_review, to_char(p_day, 'MM.DD.'));
  html := '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#2f3542">'
          || v_html || '</div>';
  to_review := v_review;
  return next;
end $$;

revoke execute on function public.daily_digest_content(date, text) from public, anon, authenticated;

-- Küldés: csak budapesti 7 órakor, H–Szo, naponta egyszer, és csak ha van Resend-kulcs.
create or replace function public.send_daily_digest(p_force boolean default false)
returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_now timestamp := now() at time zone 'Europe/Budapest';
  v_day date := v_now::date;
  v_key text;
  v_url text;
  v_to text;
  v_content record;
  v_request bigint;
begin
  if not p_force and (extract(hour from v_now) <> 7 or extract(isodow from v_day) = 7) then
    return 'not_time';
  end if;
  if not p_force and exists (select 1 from digest_log where day = v_day) then
    return 'already_sent';
  end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key';
  if v_key is null then
    return 'no_api_key';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'app_url';
  select u.email into v_to
    from auth.users u join app_users a on a.user_id = u.id
   where a.role = 'teacher' order by u.created_at limit 1;
  if v_to is null then
    return 'no_teacher';
  end if;

  select * into v_content
    from daily_digest_content(v_day, coalesce(v_url, 'https://napi-matek.andras-brutoczki.workers.dev'));

  select net.http_post(
           url := 'https://api.resend.com/emails',
           headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
           body := jsonb_build_object('from', 'Napi matek <onboarding@resend.dev>', 'to', jsonb_build_array(v_to),
                                      'subject', v_content.subject, 'html', v_content.html))
    into v_request;

  -- A kézi próbaküldés (p_force) nem számít bele: a reggeli levél aznap is kimegy.
  if not p_force then
    insert into digest_log (day, request_id) values (v_day, v_request);
  end if;
  return 'sent';
end $$;

revoke execute on function public.send_daily_digest(boolean) from public, anon, authenticated;

-- Ütemezés (csak ahol van pg_cron): 5:00 és 6:00 UTC = 7:00 Budapest nyáron, ill. télen.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('napi-matek-osszefoglalo', '0 5,6 * * 1-6', 'select public.send_daily_digest()');
  end if;
end $$;
