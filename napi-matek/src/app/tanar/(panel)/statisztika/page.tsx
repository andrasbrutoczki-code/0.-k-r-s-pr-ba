import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import { loadStats, percent } from "@/lib/stats/load";
import { todayInBudapest } from "@/lib/schedule";
import { EMPTY_STATS } from "@/components/stats-view";

export const metadata: Metadata = { title: "Statisztika" };

/** Áttekintés: minden tanuló sorozata, heti haladása és összesítői egy táblázatban. */
export default async function TeacherStatsPage() {
  const { supabase } = await requireTeacher();
  const today = todayInBudapest();
  const [{ data: students }, stats] = await Promise.all([
    supabase.from("students").select("id, display_name, disabled_at").order("display_name"),
    loadStats(supabase, today),
  ]);
  const list = (students ?? []) as { id: string; display_name: string; disabled_at: string | null }[];

  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Statisztika</h1>
        <p className="text-muted">A ma bezárólag kiosztott feladatok alapján.</p>
      </header>

      {list.length === 0 ? (
        <p className="text-muted">Még nincs tanuló.</p>
      ) : (
        <div className="sheet overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead className="border-b border-rule text-sm text-muted">
              <tr>
                <th className="py-2 pr-3">Tanuló</th>
                <th className="px-2 py-2 text-right">Sorozat</th>
                <th className="px-2 py-2 text-right">Legjobb</th>
                <th className="px-2 py-2 text-right">E hét</th>
                <th className="px-2 py-2 text-right">Beadva</th>
                <th className="px-2 py-2 text-right">Elfogadva</th>
                <th className="px-2 py-2 text-right">Késve</th>
                <th className="px-2 py-2 text-right">Teszt helyes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const st = stats.get(s.id) ?? EMPTY_STATS;
                const t = st.totals;
                return (
                  <tr key={s.id} className="border-b border-rule/60">
                    <td className="py-2 pr-3">
                      <Link
                        href={`/tanar/statisztika/${s.id}`}
                        className="font-bold text-ink underline-offset-4 hover:underline"
                      >
                        {s.display_name}
                      </Link>
                      {s.disabled_at ? <span className="ml-2 text-sm text-muted">(letiltva)</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right text-lg font-bold">{st.streak.current}</td>
                    <td className="px-2 py-2 text-right">{st.streak.best}</td>
                    <td className="px-2 py-2 text-right">
                      {st.week.done}/{st.week.total}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {t.submitted}/{t.assigned} ({percent(t.submitted, t.assigned)})
                    </td>
                    <td className="px-2 py-2 text-right">{t.accepted}</td>
                    <td className="px-2 py-2 text-right">{t.late}</td>
                    <td className="px-2 py-2 text-right">
                      {t.testChecked ? percent(t.testCorrect, t.testChecked) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="max-w-prose text-sm text-muted">
        Sorozat: hétköznap az a nap számít, amikor a tanuló legalább egy feladatot beadott; a szombat akkor, ha szombat
        estig a hét összes feladata kész. „E hét”: a hét összes feladatából ennyi van beadva.
      </p>
    </main>
  );
}
