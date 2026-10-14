import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/lib/auth/guards";
import { loadStats } from "@/lib/stats/load";
import { todayInBudapest } from "@/lib/schedule";
import { EMPTY_STATS, StreakCalendar, StreakSummary, TopicTable } from "@/components/stats-view";

export const metadata: Metadata = { title: "Statisztikám" };

/** A tanuló saját statisztikája: sorozat, naptár, témakörök. */
export default async function StudentStatsPage() {
  const { supabase, user } = await requireStudent();
  const today = todayInBudapest();
  const stats = (await loadStats(supabase, today, user.id)).get(user.id) ?? EMPTY_STATS;

  return (
    <main className="space-y-8">
      <p>
        <Link href="/tanulo" className="text-ink underline-offset-4 hover:underline">
          ← Mai feladat
        </Link>
      </p>
      <h1 className="text-2xl font-bold">Statisztikám</h1>

      <StreakSummary stats={stats} />

      <section aria-labelledby="cal-title" className="space-y-3">
        <h2 id="cal-title" className="text-xl font-bold">
          Az utolsó hetek
        </h2>
        <StreakCalendar stats={stats} today={today} />
        <p className="max-w-prose text-sm text-muted">
          Hétköznap akkor nő a sorozat, ha aznap beadsz legalább egy feladatot. A szombat akkor számít, ha szombat
          estig a hét összes feladata be van adva. A vasárnap és a feladat nélküli napok nem szakítják meg.
        </p>
      </section>

      <section aria-labelledby="topic-title" className="space-y-3">
        <h2 id="topic-title" className="text-xl font-bold">
          Témakörök
        </h2>
        <TopicTable stats={stats} showTests={false} />
      </section>
    </main>
  );
}
