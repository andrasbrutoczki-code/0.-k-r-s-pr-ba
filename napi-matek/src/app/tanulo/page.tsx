import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/lib/auth/guards";
import { formatDayWithWeekday, isoWeekday, todayInBudapest } from "@/lib/schedule";
import { loadTaskDetails, loadTaskSummaries, type TaskSummary } from "@/lib/student/tasks";
import { TASK_TYPE_LABEL } from "@/lib/task-types";
import { StatusBadge } from "@/components/status-badge";
import { loadStats } from "@/lib/stats/load";
import { TaskCard } from "./task-card";

export const metadata: Metadata = { title: "Mai feladat" };

/** A korábbi (már beadott) feladatokból ennyit mutatunk a kezdőlapon. */
const HISTORY_LIMIT = 20;

function TaskRow({ task }: { task: TaskSummary }) {
  return (
    <li>
      <Link
        href={`/tanulo/feladat/${task.id}`}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rule bg-sheet px-4 py-3 hover:border-ink"
      >
        <span>
          <span className="block font-bold text-ink">{task.title}</span>
          <span className="text-sm text-muted">
            {formatDayWithWeekday(task.scheduledDate)}, {TASK_TYPE_LABEL[task.type].toLowerCase()}
          </span>
        </span>
        <StatusBadge status={task.status} late={task.isLate} />
      </Link>
    </li>
  );
}

/**
 * A tanuló kezdőlapja.
 *   1. „Mai feladat”: a mai nap feladatai teljes terjedelemben, a beadással
 *      együtt – így a fotós beadás innen három érintéssel megoldható.
 *   2. Nyitott feladatok: korábbi napok be nem adott vagy javítandó feladatai.
 *      Szombaton (pótlónap) ez a lista kerül előre „Pótolnivalók” címmel.
 *   3. Korábbi feladatok: a már beadottak.
 */
export default async function StudentHome() {
  const { supabase, user } = await requireStudent();
  const today = todayInBudapest();
  const isSaturday = isoWeekday(today) === 6;

  const [summaries, statsByStudent] = await Promise.all([
    loadTaskSummaries(supabase),
    loadStats(supabase, today, user.id),
  ]);
  const streak = statsByStudent.get(user.id)?.streak;
  const todays = summaries.filter((t) => t.scheduledDate === today);
  const open = summaries.filter(
    (t) => t.scheduledDate < today && (t.status === "not_started" || t.status === "needs_revision"),
  );
  const history = summaries
    .filter((t) => t.scheduledDate < today && t.status !== "not_started" && t.status !== "needs_revision")
    .slice(0, HISTORY_LIMIT);
  const details = await loadTaskDetails(supabase, user.id, todays.map((t) => t.id));

  const openSection = (
    <section aria-labelledby="open-title" className="space-y-3">
      <h2 id="open-title" className="text-xl font-bold">
        {isSaturday ? "Pótolnivalók" : "Nyitott feladatok"}
      </h2>
      {open.length === 0 ? (
        <p className="text-muted">Nincs elmaradásod. Így tovább!</p>
      ) : (
        <ul className="space-y-2">
          {[...open].reverse().map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <main className="space-y-8">
      <Link
        href="/tanulo/statisztika"
        className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-rule bg-sheet px-4 py-3 hover:border-ink"
      >
        <span>
          <span className="text-2xl font-bold text-ink">{streak?.current ?? 0}</span>{" "}
          <span className="font-bold">napos sorozat</span>
          {streak && streak.best > streak.current ? (
            <span className="ml-2 text-sm text-muted">(legjobb: {streak.best})</span>
          ) : null}
        </span>
        <span className="text-sm font-bold text-ink">Statisztikám →</span>
      </Link>

      <section aria-labelledby="today-title" className="space-y-4">
        <header>
          <h1 id="today-title" className="text-2xl font-bold">
            {isSaturday ? "Ma pótlónap van" : "Mai feladat"}
          </h1>
          <p className="text-muted">{formatDayWithWeekday(today)}</p>
        </header>

        {isSaturday ? (
          <p className="max-w-prose">
            Szombaton nincs új feladat: pótold a hét elmaradt feladatait. Ha ma estig mindet beadod, a mai nap is
            beleszámít a sorozatodba.
          </p>
        ) : details.length === 0 ? (
          <p className="sheet">Mára nincs kiosztott feladatod.</p>
        ) : (
          details.map((task) => <TaskCard key={task.id} task={task} studentId={user.id} />)
        )}
      </section>

      {openSection}

      {history.length > 0 ? (
        <section aria-labelledby="history-title" className="space-y-3">
          <h2 id="history-title" className="text-xl font-bold">
            Korábbi feladatok
          </h2>
          <ul className="space-y-2">
            {history.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
