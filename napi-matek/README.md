# Napi matek

Gyakorlófelület emelt szintű matematika érettségire: a tanár feladatokat oszt ki,
a tanulók naponta megoldják és fotóként beadják, a tanár visszajelzést ad.

**Állapot:** az 1–2. lépés kész: belépés és tanulókezelés; feladatbank (KaTeX,
ábra, tömeges import), munkalapok ütemezéssel, csoportos kiosztás és tanulónkénti
módosítás. Következik: tanulói felület és fotós beadás → tanári ellenőrzés →
statisztika.

## Technológia és döntések

| Réteg | Választás | Miért |
|---|---|---|
| App | Next.js 15 (App Router, TypeScript, Server Actions) | UI és szerveroldali logika egy kódbázisban; a titkos kulcs nem kerül a böngészőbe. |
| Adat, Auth, fájlok | Supabase (Postgres + RLS, Auth, Storage) | A jogosultság az adatbázisban dől el: egy hibás lekérdezés sem ad ki idegen adatot. |
| Stílus | Tailwind CSS 4, saját kis komponensek | Kevés függőség, egy helyen élő design tokenek (`src/app/globals.css`). |
| Validáció | zod | Ugyanaz a séma ellenőrzi az űrlapokat és (később) az importot. |
| Hoszting | Netlify (ingyenes) + Supabase (ingyenes) | A Vercel ingyenes csomagja nem engedi a kereskedelmi használatot. |

### Belépés és jogosultságok

- **Tanár:** e-mail + jelszó (Supabase Auth).
- **Tanuló:** név + 8 karakteres kód. Minden tanulóhoz tartozik egy szintetikus,
  e-mailt nem kapó Auth felhasználó (`s-<uuid>@students.invalid`), jelszó nélkül.
  A szerver ellenőrzi a kódot (bcrypt), majd az admin API egyszer használható
  tokenjével munkamenetet hoz létre. E-mail nem megy ki.
- **Munkamenet:** eszközönként 365 nap. Az utolsó 7 napban a tanuló a kód
  újbóli megadásával meghosszabbíthatja; ha nem teszi, lejáratkor kilép.
- **Visszavonás:** új kód generálásakor vagy letiltáskor a tanuló minden
  eszközről azonnal kilép (kódverzió + munkamenet-nyilvántartás + Auth
  munkamenetek törlése).
- **Brute force:** IP-nként 10, névenként 5 próbálkozás 15 percenként.
- **Védelmi rétegek:** a middleware csak a tokent frissíti; a jogosultságot a
  layoutok/actionök őrei (`requireTeacher`, `requireStudent`) és végső soron az
  adatbázis RLS-e (`current_student_id()`) ellenőrzi.

### Adatvédelem (GDPR)

- A tanulóról csak egy név/becenév tárolódik; e-mail, születési dátum nincs.
- A kód csak hash-ként van tárolva; a tanár egyszer, létrehozáskor látja.
- Törléshez való jog: letiltott tanuló véglegesen törölhető; ezzel a neve,
  belépései, feladatai, feltöltött képei és üzenetei is törlődnek.
- A betűtípus buildkor letöltődik és saját domainről megy ki: a böngésző nem
  kapcsolódik a Google-höz.
- A képek (3. lépés) privát tárolóban lesznek, csak lejáró, aláírt URL-lel.

## Projektstruktúra

```
src/
  app/
    belepes/            tanulói belépés (név + kód)
    kilepes/            kilépés (Route Handler)
    tanulo/             tanulói felület (őr: requireStudent)
    tanar/belepes/      tanári belépés
    tanar/(panel)/      tanári felület (őr: requireTeacher)
      tanulok/          tanulók felvétele, új kód, letiltás, törlés
      feladatok/        feladatbank, szerkesztő, import
      munkalapok/       munkalapok, ütemezés, csoportos kiosztás
      kiosztasok/       kiosztás tanulónként, áthelyezés, csere
  components/           közös UI-elemek
  lib/
    auth/               belépési logika, őrök, kódformázás
    supabase/           kliensek (felhasználói és titkos kulcsos)
  middleware.ts         munkamenet-frissítés
supabase/migrations/    adatbázis séma és RPC-k, időrendben
public/mintak/          import-mintafájlok (JSON 21 feladattal, köztük teszt; CSV; ZIP ábrával)
scripts/seed.mjs        tanár + 3 tanuló létrehozása (az 5 mintafeladat migrációban van)
scripts/test-db.sh      adatbázis-tesztek sima PostgreSQL-en
tests/sql/              RLS- és üzleti szabály tesztek
tests/unit/             unit tesztek (vitest)
```

## Telepítés

### 1. Supabase projekt

1. Hozz létre egy ingyenes projektet a [supabase.com](https://supabase.com)-on.
   Régió: **Central EU (Frankfurt)**, hogy az adatok az EU-ban maradjanak.
2. **SQL Editor:** futtasd le a `supabase/migrations/` fájljait **név szerinti
   sorrendben** (mindegyiket egyszer).
   Supabase CLI-vel ugyanez: `supabase link --project-ref <ref>` majd `supabase db push`.
3. **Authentication → Sign In / Providers:** kapcsold ki az „Allow new users to
   sign up” opciót. Fiókot csak a tanári felület (és a seed) hozhat létre.
4. **Project Settings → API Keys:** innen kell a projekt URL, a publishable és
   a secret kulcs.

### 2. Helyi futtatás

Node.js 20.9 vagy újabb kell.

```bash
npm install
cp .env.example .env.local     # töltsd ki
npm run seed                   # tanár + 3 tanuló; kiírja a tanulók kódját
npm run dev                    # http://localhost:3000
```

### 3. Tesztek

```bash
npm run typecheck
npm test                       # unit tesztek
npm run test:db                # RLS-tesztek; kell egy helyi PostgreSQL 15+
```

A `test:db` a szokásos `PGHOST`, `PGUSER`, `PGPASSWORD` változókkal csatlakozik,
és egy ideiglenes `napi_matek_test` adatbázist használ. A GitHub Actions (CI)
minden pushnál lefuttatja az összes ellenőrzést.

### 4. Élesítés Netlify-on

1. A Netlify-on: **Add new site → Import an existing project**, válaszd ki a
   GitHub-repót. A Next.js-t automatikusan felismeri.
2. **Site configuration → Environment variables:** add meg a három
   `SUPABASE` változót a `.env.example` alapján. A `SUPABASE_SECRET_KEY`
   legyen „secret” jelölésű.
3. Deploy. Ezután a Supabase-ben (**Authentication → URL Configuration**)
   állítsd a Site URL-t a Netlify-címre.

A Supabase ingyenes projektje egy hét teljes inaktivitás után szünetel;
napi használat mellett ez nem fordul elő.

## Feladatok importálása

A Feladatbank → **Importálás fájlból** oldalon JSON, CSV vagy ZIP (JSON/CSV +
PNG ábrák) tölthető fel. Importálás előtt minden sor ellenőrzött előnézetet kap;
a hibás sorok kimaradnak, a hibátlanok egy tranzakcióban kerülnek be.

| Mező | Kötelező | Leírás |
|---|---|---|
| `cim` | igen | a feladat címe |
| `szoveg` | igen | a feladat szövege; képlet `$…$`, kiemelt képlet `$$…$$`, dollárjel `\$` |
| `temakor` | igen | a témakör neve vagy rövid neve (pl. `fuggvenyek` vagy `Függvények`) |
| `nehezseg` | igen | 1–5 |
| `kep_kell` | nem | igen/nem: csak fényképpel adható-e be (alapból igen) |
| `abra` | nem | PNG fájlnév, csak ZIP-csomagban |
| `tipus` | nem | `teszt`, `rovid` vagy `kifejtos`; ha hiányzik, a szövegből következtetjük |
| `ido_perc` | nem | becsült megoldási idő (1–120 perc) |
| `megoldasi_utmutato` | nem | csak a tanár látja |
| `helyes` | nem | tesztnél a helyes válasz betűje (A–F); hiányában az útmutató „Helyes válasz: (B)” kezdetéből |

JSON: `{ "feladatok": [ { "cim": …, … } ] }` vagy egyszerű tömb. CSV: fejléc a
fenti mezőnevekkel, pontosvessző (magyar Excel) vagy vessző elválasztóval.
Mintafájlok: `public/mintak/`.

## Beadás feladattípusonként (a 3. lépés terve)

| Típus | Beadás |
|---|---|
| Teszt | a válasz betűjele külön gombbal (A–D) + rövid szöveges indoklás; kép nem kell |
| Rövid válasz | az eredmény szövegmezőbe írva |
| Kifejtős | fénykép(ek) a levezetésről |

**Szombat = pótlónap.** Munkalapra csak hétfőtől péntekig kerül feladat. Szombaton
a tanuló a hét elmaradt feladatait pótolja; a szombat akkor számít a sorozatba, ha
szombat végéig a hét minden feladata be van adva.
