import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import { formatDate } from "@/lib/dates";
import { Button, Field, Input, Notice } from "@/components/ui";
import { createWorksheetAction } from "./actions";

export const metadata: Metadata = { title: "Munkalapok" };

interface WorksheetRow {
  id: string;
  title: string;
  is_template: boolean;
  updated_at: string;
  worksheet_items: { count: number }[];
  assignments: { count: number }[];
}

function WorksheetList({ items, empty }: { items: WorksheetRow[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((w) => {
        const tasks = w.worksheet_items[0]?.count ?? 0;
        const assigned = w.assignments[0]?.count ?? 0;
        return (
          <li key={w.id} className="rounded-md border border-rule bg-sheet p-4">
            <Link href={`/tanar/munkalapok/${w.id}`} className="text-lg font-bold text-ink underline-offset-4 hover:underline">
              {w.title}
            </Link>
            <p className="text-sm text-muted">
              {tasks} feladat
              {assigned > 0 ? `, ${assigned}× kiosztva` : ", még nincs kiosztva"}
              , módosítva: {formatDate(w.updated_at)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default async function WorksheetsPage() {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase
    .from("worksheets")
    .select("id, title, is_template, updated_at, worksheet_items(count), assignments(count)")
    .order("updated_at", { ascending: false });
  const worksheets = (data ?? []) as WorksheetRow[];

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Munkalapok</h1>
        <p className="max-w-prose text-muted">
          A munkalap sorrendbe rendezett feladatok listája, napokra ütemezve. Egy művelettel több tanulónak is
          kiosztható, utána tanulónként módosítható.
        </p>
      </header>

      <section className="sheet" aria-labelledby="new-ws-title">
        <h2 id="new-ws-title" className="mb-4 text-xl font-bold">
          Új munkalap
        </h2>
        <form action={createWorksheetAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Cím" htmlFor="ws-title">
              <Input id="ws-title" name="title" required maxLength={120} placeholder="pl. Függvények, 1. hét" />
            </Field>
          </div>
          <label className="flex min-h-12 items-center gap-2">
            <input type="checkbox" name="is_template" className="h-5 w-5" />
            Sablon
          </label>
          <Button type="submit">Létrehozás</Button>
        </form>
      </section>

      {error ? <Notice tone="error">A munkalapok nem tölthetők be.</Notice> : null}

      <section className="space-y-3" aria-labelledby="ws-list-title">
        <h2 id="ws-list-title" className="text-xl font-bold">
          Munkalapjaim
        </h2>
        <WorksheetList
          items={worksheets.filter((w) => !w.is_template)}
          empty="Még nincs munkalapod. Hozd létre az elsőt a fenti mezővel."
        />
      </section>

      <section className="space-y-3" aria-labelledby="tpl-list-title">
        <h2 id="tpl-list-title" className="text-xl font-bold">
          Sablonok
        </h2>
        <WorksheetList
          items={worksheets.filter((w) => w.is_template)}
          empty="Nincs sablon. Bármelyik munkalapot elmentheted sablonként a szerkesztőjében."
        />
      </section>
    </main>
  );
}
