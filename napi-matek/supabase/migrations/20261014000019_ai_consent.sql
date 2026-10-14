-- Szülői hozzájárulás az AI-asszisztenshez, tanulónként. Alapból NINCS:
-- az AI csak a hozzájárulás rögzítése után kérhető (lásd a szülői tájékoztatót).
alter table public.students add column ai_consent boolean not null default false;
comment on column public.students.ai_consent is
  'A szülő hozzájárult-e, hogy a beadásokat AI-asszisztens is elemezze (tanár állítja).';
