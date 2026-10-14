# Napi matek

Gyakorlófelület emelt szintű matematika érettségire: a tanár feladatokat oszt ki,
a tanulók naponta megoldják és fotóként beadják, a tanár visszajelzést ad.

**Állapot:** mind az öt lépés kész: belépés és tanulókezelés; feladatbank (KaTeX,
ábra, tömeges import), munkalapok, hétgenerátor és kiosztás; tanulói felület fotós
beadással; tanári ellenőrzés tesztjavítással és AI-asszisztenssel; statisztika
(sorozat, naptár, témakörök). Később: napi e-mail-összefoglaló.

## Technológia és döntések

| Réteg | Választás | Miért |
|---|---|---|
| App | Next.js 15 (App Router, TypeScript, Server Actions) | UI és szerveroldali logika egy kódbázisban; a titkos kulcs nem kerül a böngészőbe. |
| Adat, Auth, fájlok | Supabase (Postgres + RLS, Auth, Storage) | A jogosultság az adatbázisban dől el: egy hibás lekérdezés sem ad ki idegen adatot. |
| Stílus | Tailwind CSS 4, saját kis komponensek | Kevés függőség, egy helyen élő design tokenek (`src/app/globals.css`). |
| Validáció | zod | Ugyanaz a séma ellenőrzi az űrlapokat és (később) az importot. |
| Hoszting | Cloudflare Workers (OpenNext) + Supabase (ingyenes) | A Vercel ingyenes csomagja nem engedi a kereskedelmi használatot; a Netlify ingyenes kerete havi ~20 kitelepítést enged. |

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
- A képek privát tárolóban vannak, csak lejáró, aláírt URL-lel; az EXIF-adatok
  (pl. GPS) a tömörítéskor elvesznek.
- AI-asszisztens: csak a tanár kérésére fut. A Claude API-nak a feladat, az
  útmutató, a beadás (szöveg és fotók) és az üzenetszál megy át, a tanuló neve
  nem. Az Anthropic az API-n beküldött adatokkal alapból nem tanít modellt; a
  szülőket/tanulókat érdemes tájékoztatni arról, hogy a beadásokat egy
  AI-szolgáltatás is feldolgozhatja.

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

### 4. Élesítés Cloudflare-en

A Next.js az [OpenNext](https://opennext.js.org/cloudflare) adapterrel Cloudflare
Workeren fut (`wrangler.jsonc`, `open-next.config.ts`). A nyilvános Supabase-értékek
a `.env.production` fájlban vannak; a titkos kulcs csak a Cloudflare-ben.

1. Cloudflare → **Workers & Pages → Create → Import a repository**, a GitHub-repó.
   - Project name: `napi-matek` (egyezzen a `wrangler.jsonc` nevével)
   - Root directory: `napi-matek`
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
2. A Worker → **Settings → Variables and Secrets:** `SUPABASE_SECRET_KEY`
   „Secret” típusként.
3. Supabase → **Authentication → URL Configuration:** Site URL = a Worker címe
   (`https://napi-matek.<fiók>.workers.dev`).

Korlátok az ingyenes Workers-csomagban: a Worker tömörítve legfeljebb 3 MiB, és
kérésenként kevés CPU-idő jár. Ha a build „size limit” hibát ad, vagy az oldalon
időnként 1102-es hiba jelenik meg, a Workers Paid (havi 5 USD) megoldja.

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

## Beadás feladattípusonként

| Típus | Beadás |
|---|---|
| Teszt | a válasz betűjele külön gombbal (A–D) + rövid szöveges indoklás; kép nem kell |
| Rövid válasz | az eredmény szövegmezőbe írva |
| Kifejtős | fénykép(ek) a levezetésről |

**Szombat = pótlónap.** Munkalapra csak hétfőtől péntekig kerül feladat. Szombaton
a tanuló a hét elmaradt feladatait pótolja; a szombat akkor számít a sorozatba, ha
szombat végéig a hét minden feladata be van adva.

## Ellenőrzés: tesztjavítás és AI-asszisztens

**Tesztek automatikus javítása (AI nélkül).** A tesztfeladatoknál a tanár megadja
a helyes betűt (szerkesztő, import: `helyes`). Az ellenőrzésnél a választás
mellett ✓/✗ jelzés látszik, az áttekintő listában is.

**AI-javaslat.** A beadás oldalán az „AI-javaslat kérése” gomb a
`supabase/functions/ai-review` Edge Functiont hívja. Ez elolvassa a feladatot, az
útmutatót, a tanuló válaszát/indoklását és a fotóit, majd döntést (elfogadás /
javítás / bizonytalan), hibalistát és visszajelzés-tervezetet ad. A tanuló ebből
semmit nem lát, amíg a tanár át nem veszi és el nem küldi. Beadott változatonként
legfeljebb 3 javaslat kérhető.

Beállítás:
1. <https://console.anthropic.com> → API Keys → új kulcs (és egyenleg feltöltése).
2. Supabase → Edge Functions → Secrets: `ANTHROPIC_API_KEY` = a kulcs.
   Nem kötelező: `AI_REVIEW_MODEL` (alapból `claude-sonnet-5-5`).
3. Telepítés (ha módosul): `supabase functions deploy ai-review`.

Miért Edge Function? Egy képes elemzés 20–60 mp is lehet; a Supabase Edge Function
ezt bírja, és így a weboldal kiszolgálójától független.

## Statisztika

- **Sorozat:** hétfőtől péntekig az a nap számít, amikor a tanuló legalább egy
  feladatot beadott (budapesti idő szerint); ha volt feladata, de nem adott be,
  a sorozat megszakad. A szombat akkor számít, ha szombat estig a hét minden
  feladata be van adva. A vasárnap és a feladat nélküli napok semlegesek; a mai
  nap, amíg tart, nem szakít meg. Kód: `src/lib/stats/streak.ts` (egységtesztelt).
- **Tanuló:** a kezdőlapon a sorozat, a „Statisztikám” oldalon 6 hetes naptár és
  témakörönkénti táblázat.
- **Tanár:** Statisztika menü – minden tanuló sorozata, heti haladása,
  beadási aránya, késései és tesztpontossága; tanulónként részletes nézet.
- Az összesítőket az adatbázis számolja (`stats_daily`, `stats_weekly`,
  `stats_topics`), RLS alatt: a tanuló csak a sajátját látja, a helyes válaszokat
  nem kapja meg.
