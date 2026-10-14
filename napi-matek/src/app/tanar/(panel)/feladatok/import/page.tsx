import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import { normalizeKey } from "@/lib/import/parse";
import { loadTopics } from "@/lib/topics";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Feladatok importálása" };

const SAMPLES = [
  { href: "/mintak/feladatok-minta.json", label: "JSON minta (21 feladat, köztük egy teszt)" },
  { href: "/mintak/feladatok-minta.csv", label: "CSV minta (pontosvesszős)" },
  { href: "/mintak/feladatok-minta-abraval.zip", label: "ZIP minta ábrával" },
];

export default async function ImportPage() {
  const { supabase } = await requireTeacher();
  const [topicList, { data: titles }] = await Promise.all([
    loadTopics(supabase),
    supabase.from("tasks").select("title"),
  ]);

  return (
    <main className="space-y-6">
      <p>
        <Link href="/tanar/feladatok" className="text-ink underline-offset-4 hover:underline">
          ← Feladatbank
        </Link>
      </p>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Feladatok importálása</h1>
        <p className="max-w-prose text-muted">
          Importálás előtt minden sort ellenőrzünk, és megmutatjuk az előnézetet. A hibás sorok kimaradnak,
          a hibátlanok egyszerre kerülnek be: ha bármi elakad, egyetlen feladat sem kerül be félig.
        </p>
      </header>

      <section className="sheet space-y-4" aria-labelledby="format-title">
        <h2 id="format-title" className="text-xl font-bold">
          A fájl formátuma
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-[0.95rem] sm:grid-cols-[auto_1fr]">
          <dt className="font-bold">cim</dt>
          <dd>a feladat címe (kötelező)</dd>
          <dt className="font-bold">szoveg</dt>
          <dd>a feladat szövege, képletek $…$ és $$…$$ között (kötelező)</dd>
          <dt className="font-bold">temakor</dt>
          <dd>
            egy vagy több témakör neve vagy rövid neve (kötelező). Több témakört „|” jellel válassz el (pl.{" "}
            <code>logaritmus|exponencialis</code>), JSON-ban tömb is lehet; az első az elsődleges.{" "}
            <span className="text-muted">
              {topicList.map((t) => `${t.name} (${t.slug})`).join("; ")}
            </span>
          </dd>
          <dt className="font-bold">nehezseg</dt>
          <dd>1–5 (kötelező)</dd>
          <dt className="font-bold">tipus</dt>
          <dd>teszt, rovid vagy kifejtos; ha hiányzik: (A)/(B) válaszlehetőségnél teszt, egyébként kifejtős</dd>
          <dt className="font-bold">ido_perc</dt>
          <dd>becsült megoldási idő percben (1–120); ha hiányzik, típus és nehézség alapján becsüljük</dd>
          <dt className="font-bold">kep_kell</dt>
          <dd>igen/nem: csak fényképpel adható-e be (alapból csak a kifejtős)</dd>
          <dt className="font-bold">abra</dt>
          <dd>PNG fájlnév; csak ZIP-csomagban, a JSON/CSV mellé téve</dd>
          <dt className="font-bold">megoldasi_utmutato</dt>
          <dd>csak a tanár látja (nem kötelező)</dd>
          <dt className="font-bold">helyes</dt>
          <dd>
            tesztnél a helyes válasz betűje (A–F); ebből javítjuk automatikusan a tanuló választását. Ha hiányzik, az
            útmutató „Helyes válasz: (B) …” kezdetéből olvassuk ki.
          </dd>
        </dl>
        <p className="text-sm text-muted">A „pontszam” mezőt elfogadjuk, de nem használjuk.</p>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {SAMPLES.map((s) => (
            <li key={s.href}>
              <a href={s.href} download className="font-bold text-ink underline-offset-4 hover:underline">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="sheet">
        <ImportWizard
          topics={topicList}
          existingTitles={((titles ?? []) as { title: string }[]).map((t) => normalizeKey(t.title))}
        />
      </section>
    </main>
  );
}
