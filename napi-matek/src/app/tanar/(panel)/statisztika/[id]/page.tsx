import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import { loadStats } from "@/lib/stats/load";
import { todayInBudapest } from "@/lib/schedule";
import { EMPTY_STATS, StreakCalendar, StreakSummary, TopicTable } from "@/components/stats-view";

export const metadata: Metadata = { title: "Tanuló statisztikája" };

/** Egy tanuló részletes statisztikája (a tanuló saját nézete + tesztpontosság). */
export default async function StudentStatsForTeacher({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireTeacher();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const today = todayInBudapest();
  const [{ data: student }, stats] = await Promise.all([
    supabase.from("students").select("id, display_name").eq("id", id).maybeSingle<{ id: string; display_name: string }>(),
    loadStats(supabase, today, id),
  ]);
  if (!student) notFound();
  const s = stats.get(id) ?? EMPTY_STATS;

  return (
    <main className="space-y-8">
      <p>
        <Link href="/tanar/statisztika" className="text-ink underline-offset-4 hover:underline">
          ← Statisztika
        </Link>
      </p>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-bold">{student.display_name}</h1>
        <Link
          href={`/tanar/ellenorzes?tanulo=${id}`}
          className="font-bold text-ink underline-offset-4 hover:underline"
        >
          Feladatai az ellenőrzésben →
        </Link>
      </header>
      <StreakSummary stats={s} />
      <section aria-labelledby="cal-title" className="sheet space-y-3">
        <h2 id="cal-title" className="text-xl font-bold">
          Az utolsó hetek
        </h2>
        <StreakCalendar stats={s} today={today} />
      </section>
      <section aria-labelledby="topic-title" className="sheet space-y-3">
        <h2 id="topic-title" className="text-xl font-bold">
          Témakörök
        </h2>
        <TopicTable stats={s} showTests />
      </section>
    </main>
  );
}
