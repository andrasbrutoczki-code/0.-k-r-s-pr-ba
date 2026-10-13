-- =============================================================================
-- Napi Matek – adatbázis séma (TERVEZET, jóváhagyásra)
-- Supabase / PostgreSQL 15+
--
-- Alapelvek
--   * Minden tábla RLS-sel védett; a kliens soha nem kap service_role kulcsot.
--   * Állapotváltó műveletek (beadás, kiosztás, kódgenerálás) SECURITY DEFINER
--     RPC-kben futnak, így az üzleti szabályok egy helyen, az adatbázisban élnek.
--   * A tanuló „mai napja” mindig Europe/Budapest időzónában értendő.
--   * A munkalap kiosztáskor tanulónként „lemásolódik” (student_tasks), így a
--     munkalap későbbi szerkesztése nem írja át a már kiosztott feladatokat,
--     és tanulónként egyedi módosítás lehetséges.
-- =============================================================================

-- Supabase-en a pgcrypto az `extensions` sémában él; a függvényeket ezért
-- minősítés nélkül hívjuk, és a SECURITY DEFINER függvények search_path-jába
-- felvesszük az `extensions` sémát.
create extension if not exists pgcrypto;   -- crypt()/gen_salt()/gen_random_bytes()

-- Belépési név normalizálása: kisbetű, magyar ékezetek nélkül, egyszerű szóközök.
-- Így „Kiss Ánna”, „kiss anna” és „KISS  ANNA” ugyanazt a tanulót azonosítja.
-- IMMUTABLE (translate-tel, nem unaccent-tel), ezért generált oszlopban használható.
create or replace function public.normalize_login_name(p text) returns text
language sql immutable as $$
  select regexp_replace(
           translate(lower(btrim(p)), 'áéíóöőúüűäâàèêëîôûç', 'aeiooouuuaaaeeeiouc'),
           '\s+', ' ', 'g')
$$;

-- Belépőkód normalizálása: nagybetű, minden nem alfanumerikus karakter (kötőjel,
-- szóköz) eltávolítva. „abcd-efgh” → „ABCDEFGH”.
create or replace function public.normalize_login_code(p text) returns text
language sql immutable as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g')
$$;

-- -----------------------------------------------------------------------------
-- 0. Segédfüggvények: idő
-- -----------------------------------------------------------------------------

-- A "mai nap" Budapesten. Minden ütemezési döntés ezt használja.
create or replace function public.today_bp() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Budapest')::date
$$;

-- Egy budapesti naptári nap vége (23:59:59.999) timestamptz-ként.
create or replace function public.end_of_day_bp(d date) returns timestamptz
language sql immutable as $$
  select ((d + 1)::timestamp at time zone 'Europe/Budapest') - interval '1 millisecond'
$$;

-- -----------------------------------------------------------------------------
-- 1. Felhasználók és szerepkörök
-- -----------------------------------------------------------------------------

create type public.user_role as enum ('teacher', 'student');

-- Minden auth.users sorhoz egy szerepkör. A tanár normál e-mail+jelszó user,
-- a tanuló szintetikus, nem kézbesíthető e-mail-című user (s-<uuid>@students.invalid),
-- jelszó nélkül: munkamenetet csak a szerveroldali kód-ellenőrzés után kap.
create table public.app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       public.user_role not null,
  created_at timestamptz not null default now()
);

create table public.students (
  id              uuid primary key references public.app_users(user_id) on delete cascade,
  display_name    text   not null check (char_length(btrim(display_name)) between 1 and 40),
  -- Belépéskor a név + kód párost ellenőrizzük. A név normalizált alakja egyedi,
  -- így két tanuló nem kaphat összetéveszthető nevet.
  login_key       text generated always as (public.normalize_login_name(display_name)) stored unique,
  disabled_at     timestamptz,             -- nem null = letiltva
  created_at      timestamptz not null default now()
);

-- A kód hash-e KÜLÖN táblában, policy nélkül: a kliens semmilyen szerepkörrel
-- nem olvashatja, csak a SECURITY DEFINER függvények és a service role.
-- A nyers kódot sehol nem tároljuk; csak létrehozáskor/újrageneráláskor
-- jelenik meg egyszer a tanárnak.
create table public.student_credentials (
  student_id   uuid primary key references public.students(id) on delete cascade,
  code_hash    text not null,              -- crypt(code, gen_salt('bf', 10))
  code_version int  not null default 1,    -- újrageneráláskor nő → régi munkamenetek érvénytelenek
  rotated_at   timestamptz not null default now()
);

-- Eszközönkénti tanulói munkamenet. A Supabase JWT `session_id` claimjéhez kötjük,
-- így a 365 napos élettartamot és a visszavonást az adatbázis is kikényszeríti
-- (nem csak a middleware).
create table public.student_sessions (
  session_id    uuid primary key,          -- = auth.jwt() ->> 'session_id'
  student_id    uuid not null references public.students(id) on delete cascade,
  code_version  int  not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,      -- created_at + 365 nap
  revoked_at    timestamptz,
  user_agent    text                        -- csak a tanári „eszközök” listához
);
create index on public.student_sessions (student_id);

-- IP- és névalapú brute force védelem (fix ablakos számláló).
create table public.login_attempts (
  bucket       text        not null,       -- 'ip:1.2.3.4' vagy 'name:kati'
  window_start timestamptz not null,
  attempts     int         not null default 0,
  primary key (bucket, window_start)
);

-- -----------------------------------------------------------------------------
-- 2. Jogosultsági segédfüggvények (RLS-ben használjuk)
-- -----------------------------------------------------------------------------

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users where user_id = auth.uid() and role = 'teacher'
  )
$$;

-- Az aktuális kérés tanulójának azonosítója, HA a tanuló aktív és a munkamenete
-- érvényes (nem járt le, nincs visszavonva, a kódverzió aktuális). Minden más
-- esetben NULL → az RLS policyk semmit sem engednek.
create or replace function public.current_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select s.id
  from students s
  join student_credentials c on c.student_id = s.id
  join student_sessions ss
    on ss.student_id = s.id
   and ss.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  where s.id = auth.uid()
    and s.disabled_at is null
    and ss.revoked_at is null
    and ss.expires_at > now()
    and ss.code_version = c.code_version
$$;

-- -----------------------------------------------------------------------------
-- 3. Feladatbank
-- -----------------------------------------------------------------------------

create table public.topics (
  id    smallint generated always as identity primary key,
  slug  text not null unique,              -- 'fuggvenyek'
  name  text not null unique               -- 'Függvények'
);

create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(title) between 1 and 200),
  body_md        text not null,             -- Markdown + $…$ / $$…$$ LaTeX (KaTeX)
  topic_id       smallint not null references public.topics(id),
  difficulty     smallint not null check (difficulty between 1 and 5),
  requires_image boolean  not null default true,  -- kifejtős: csak képpel adható be
  figure_path    text,                      -- 'task-figures' bucket, PNG
  archived_at    timestamptz,               -- soft delete: kiosztott feladat nem törölhető
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.tasks (topic_id, difficulty) where archived_at is null;

-- A megoldási útmutató külön táblában, CSAK a tanárnak látható.
-- (Oszlopszintű RLS nincs, ezért a szétválasztás a legtisztább védelem.)
create table public.task_solutions (
  task_id     uuid primary key references public.tasks(id) on delete cascade,
  solution_md text not null
);

-- -----------------------------------------------------------------------------
-- 4. Munkalapok és ütemezés
-- -----------------------------------------------------------------------------

-- A gyakorlási hét: 1–5. nap új feladatok, 6. nap ismétlés/pótlás,
-- 7. nap (vasárnap) szünnap és egyben a hét határideje.
create table public.worksheets (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  is_template boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.worksheet_items (
  id           uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.worksheets(id) on delete cascade,
  task_id      uuid not null references public.tasks(id),
  position     int  not null,               -- sorrend a munkalapon belül
  week_no      smallint not null default 1 check (week_no >= 1),
  day_no       smallint not null check (day_no between 1 and 6),  -- H..Szo
  unique (worksheet_id, position)
);

-- Egy kiosztási esemény (csoportos kiosztás egy művelettel).
create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.worksheets(id),
  start_date   date not null check (extract(isodow from start_date) = 1), -- hétfő
  created_at   timestamptz not null default now()
);

create type public.task_status as enum (
  'not_started',     -- Nincs elkezdve
  'submitted',       -- Beadva  (tanárnál: Ellenőrzésre vár)
  'in_review',       -- Javítás alatt (tanár megnyitotta)
  'feedback_given',  -- Visszajelzés érkezett (üzenet, döntés nélkül)
  'accepted',        -- Elfogadva
  'needs_revision'   -- Javítandó
);

-- Tanulónként materializált feladat: ez a kiosztás „igazsága”.
create table public.student_tasks (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid not null references public.assignments(id) on delete cascade,
  student_id         uuid not null references public.students(id) on delete cascade,
  task_id            uuid not null references public.tasks(id),
  worksheet_item_id  uuid references public.worksheet_items(id) on delete set null,
  position           int  not null,
  scheduled_date     date not null check (extract(isodow from scheduled_date) <> 7),
  due_date           date not null,         -- az adott gyakorlási hét vasárnapja
  status             public.task_status not null default 'not_started',
  first_submitted_at timestamptz,
  last_submitted_at  timestamptz,
  is_late            boolean not null default false,
  done_seen_by_teacher_at timestamptz,      -- jelvény-számláláshoz
  updated_at         timestamptz not null default now()
);
create index on public.student_tasks (student_id, scheduled_date);
create index on public.student_tasks (status) where status = 'submitted';

-- Beadás-verziók. submitted_at NULL = piszkozat (képek már feltöltve, pipa még nincs).
-- Tanulónként és feladatonként legfeljebb egy piszkozat létezhet.
create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  student_task_id uuid not null references public.student_tasks(id) on delete cascade,
  version         int  not null,
  submitted_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (student_task_id, version)
);
create unique index one_draft_per_task
  on public.submissions (student_task_id) where submitted_at is null;

create table public.submission_images (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  storage_path  text not null unique,      -- 'submissions' bucket: {student_id}/{student_task_id}/{uuid}.jpg
  width         int, height int,
  position      smallint not null default 0,
  created_at    timestamptz not null default now()
);

-- Időbélyeges üzenetszál feladatonként (tanár ⇄ tanuló).
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  student_task_id uuid not null references public.student_tasks(id) on delete cascade,
  author_id       uuid not null references public.app_users(user_id),
  body_md         text not null check (char_length(body_md) between 1 and 5000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz               -- a címzett olvasta
);
create index on public.messages (student_task_id, created_at);

-- Biztató üzenetek (tanár szerkeszti).
create table public.encouragements (
  id         smallint generated always as identity primary key,
  text       text not null check (char_length(text) between 1 and 300),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.app_users           enable row level security;
alter table public.students            enable row level security;
alter table public.student_credentials enable row level security;  -- policy nélkül = zárva
alter table public.student_sessions    enable row level security;
alter table public.login_attempts      enable row level security;  -- policy nélkül = zárva
alter table public.topics              enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_solutions      enable row level security;
alter table public.worksheets          enable row level security;
alter table public.worksheet_items     enable row level security;
alter table public.assignments         enable row level security;
alter table public.student_tasks       enable row level security;
alter table public.submissions         enable row level security;
alter table public.submission_images   enable row level security;
alter table public.messages            enable row level security;
alter table public.encouragements      enable row level security;

-- Tanár: teljes hozzáférés a tanári táblákhoz.
do $$
declare t text;
begin
  foreach t in array array[
    'app_users','students','student_sessions','topics','tasks','task_solutions',
    'worksheets','worksheet_items','assignments','student_tasks','submissions',
    'submission_images','messages','encouragements']
  loop
    execute format(
      'create policy teacher_all on public.%I for all to authenticated
         using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;

-- Mindenki a saját szerepkörét olvashatja (az app ebből dönti el, hová irányítson).
create policy self_role on public.app_users
  for select to authenticated using (user_id = auth.uid());

-- Tanuló: csak a saját sorai, csak olvasás (írás RPC-ken keresztül).
create policy student_self on public.students
  for select to authenticated using (id = public.current_student_id());

create policy student_own_sessions on public.student_sessions
  for select to authenticated using (student_id = public.current_student_id());

create policy topics_read on public.topics
  for select to authenticated using (true);

-- A tanuló csak a mai és korábbi napra ütemezett saját feladatait látja.
create policy student_own_tasks on public.student_tasks
  for select to authenticated
  using (student_id = public.current_student_id() and scheduled_date <= public.today_bp());

-- Feladatszöveg csak akkor látható, ha a tanulónak már „elérhető” kiosztása van rá.
create policy student_visible_tasks on public.tasks
  for select to authenticated
  using (exists (
    select 1 from public.student_tasks st
    where st.task_id = tasks.id
      and st.student_id = public.current_student_id()
      and st.scheduled_date <= public.today_bp()));

create policy student_own_submissions on public.submissions
  for select to authenticated
  using (exists (
    select 1 from public.student_tasks st
    where st.id = submissions.student_task_id
      and st.student_id = public.current_student_id()));

create policy student_own_images_read on public.submission_images
  for select to authenticated
  using (exists (
    select 1 from public.submissions s join public.student_tasks st on st.id = s.student_task_id
    where s.id = submission_images.submission_id
      and st.student_id = public.current_student_id()));

-- Képet csak a SAJÁT PISZKOZATÁHOZ adhat hozzá / törölhet, és csak ha a feladat
-- beadható állapotban van. A beadott verziók így megváltoztathatatlanok.
create policy student_draft_images_write on public.submission_images
  for insert to authenticated
  with check (exists (
    select 1 from public.submissions s join public.student_tasks st on st.id = s.student_task_id
    where s.id = submission_images.submission_id
      and s.submitted_at is null
      and st.student_id = public.current_student_id()
      and st.status in ('not_started','needs_revision')
      and submission_images.storage_path like st.student_id::text || '/' || st.id::text || '/%'));

create policy student_draft_images_delete on public.submission_images
  for delete to authenticated
  using (exists (
    select 1 from public.submissions s join public.student_tasks st on st.id = s.student_task_id
    where s.id = submission_images.submission_id
      and s.submitted_at is null
      and st.student_id = public.current_student_id()));

create policy student_thread_read on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.student_tasks st
    where st.id = messages.student_task_id
      and st.student_id = public.current_student_id()));

create policy student_thread_write on public.messages
  for insert to authenticated
  with check (author_id = public.current_student_id() and exists (
    select 1 from public.student_tasks st
    where st.id = messages.student_task_id
      and st.student_id = public.current_student_id()));

create policy student_encouragements on public.encouragements
  for select to authenticated
  using (active and public.current_student_id() is not null);

-- -----------------------------------------------------------------------------
-- 6. Storage (privát bucketek, aláírt URL-lel érhetők el)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('submissions',  'submissions',  false, 5 * 1024 * 1024, array['image/jpeg','image/png']),
  ('task-figures', 'task-figures', false, 5 * 1024 * 1024, array['image/png'])
on conflict (id) do nothing;

-- Tanuló: csak a saját mappájába ír ({student_id}/...), csak onnan olvas.
create policy sub_student_rw on storage.objects for all to authenticated
  using (bucket_id = 'submissions'
         and (storage.foldername(name))[1] = public.current_student_id()::text)
  with check (bucket_id = 'submissions'
         and (storage.foldername(name))[1] = public.current_student_id()::text);

create policy storage_teacher_all on storage.objects for all to authenticated
  using (bucket_id in ('submissions','task-figures') and public.is_teacher())
  with check (bucket_id in ('submissions','task-figures') and public.is_teacher());

-- Ábra: a tanuló csak akkor kérhet rá aláírt URL-t, ha a feladat számára látható.
create policy fig_student_read on storage.objects for select to authenticated
  using (bucket_id = 'task-figures' and exists (
    select 1 from public.tasks t join public.student_tasks st on st.task_id = t.id
    where t.figure_path = storage.objects.name
      and st.student_id = public.current_student_id()
      and st.scheduled_date <= public.today_bp()));

-- -----------------------------------------------------------------------------
-- 7. Referenciaadatok
-- -----------------------------------------------------------------------------

insert into public.topics (slug, name) values
  ('halmazok-logika',   'Halmazok, logika'),
  ('algebra',           'Algebra, egyenletek'),
  ('fuggvenyek',        'Függvények'),
  ('sorozatok',         'Sorozatok'),
  ('geometria',         'Geometria'),
  ('koordinatageom',    'Koordinátageometria'),
  ('trigonometria',     'Trigonometria'),
  ('kombinatorika',     'Kombinatorika'),
  ('valoszinuseg',      'Valószínűség, statisztika'),
  ('analizis',          'Analízis');

insert into public.encouragements (text) values
  ('Szép munka, egy lépéssel közelebb az emelt érettségihez!'),
  ('Ez megvan! A rendszeresség a legjobb felkészülés.'),
  ('Kész! Holnap ugyanígy, és a sorozatod nő tovább.'),
  ('Minden megoldott feladat egy pont a vizsgán. Ügyes vagy!'),
  ('Beadva. Megérdemelsz egy rövid szünetet.');

-- Az RPC-k a következő migrációkban élnek (lépésenként):
--   20261013000002_auth.sql      – belépés, munkamenetek, tanulókezelés
--   …                            – munkalapok, beadás, ellenőrzés, statisztika
--
-- STREAK SZABÁLY (a 6. lépésben implementáljuk, itt rögzítjük):
--   * Hétfő–péntek: egy nap teljesített, ha a tanuló aznap (budapesti idő)
--     beadott legalább egy feladatot.
--   * Szombat (ismétlés/pótlás napja): akkor teljesített, ha szombat végéig
--     az adott héten kiosztott ÖSSZES feladat be van adva.
--   * Az a nap, amelyre nem volt feladat ütemezve, nem szakítja meg a sorozatot.
--   * A mai nap, amíg tart, csak növelheti a sorozatot, nem szakítja meg.
