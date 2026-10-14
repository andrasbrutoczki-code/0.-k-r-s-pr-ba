import { percent, type StudentStats } from "@/lib/stats/load";
import { calendarWeeks, type DayState } from "@/lib/stats/streak";
import { formatDayWithWeekday } from "@/lib/schedule";

/**
 * Egy tanuló statisztikája: sorozat, naptár az utolsó hetekről, témakörönkénti
 * táblázat. A tanulói és a tanári oldal is ezt használja; a tesztpontosság
 * oszlop csak a tanárnál jelenik meg (a helyes válasz csak neki ismert).
 */

const CALENDAR_WEEKS = 6;
const WEEKDAY_HEADERS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];

const CELL: Record<DayState | "future", { className: string; label: string }> = {
  done: { className: "bg-ok text-white", label: "teljesítve" },
  missed: { className: "bg-redpen text-white", label: "kimaradt" },
  pending: { className: "border-2 border-ink bg-sheet text-ink", label: "ma, még nyitott" },
  rest: { className: "bg-grid text-muted", label: "nem számít" },
  future: { className: "bg-sheet text-rule", label: "" },
};

export function StreakSummary({ stats, compact = false }: { stats: StudentStats; compact?: boolean }) {
  const { current, best } = stats.streak;
  return (
    <div className={`flex flex-wrap items-baseline gap-x-6 gap-y-1 ${compact ? "" : "sheet"}`}>
      <p>
        <span className="text-3xl font-bold text-ink">{current}</span>{" "}
        <span className="font-bold">napos sorozat</span>
      </p>
      <p className="text-muted">
        Legjobb: <strong>{best}</strong> nap
      </p>
      <p className="text-muted">
        E hét: <strong>{stats.week.done}</strong>/{stats.week.total} feladat beadva
      </p>
    </div>
  );
}

export function StreakCalendar({ stats, today }: { stats: StudentStats; today: string }) {
  const weeks = calendarWeeks(today, CALENDAR_WEEKS);
  return (
    <figure className="space-y-2">
      <div className="grid max-w-md grid-cols-7 gap-1 text-center text-xs font-bold text-muted" aria-hidden>
        {WEEKDAY_HEADERS.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
      <ol className="grid max-w-md grid-cols-7 gap-1" aria-label="Az utolsó hetek napjai">
        {weeks.flat().map((day) => {
          const state: DayState | "future" = day > today ? "future" : (stats.streak.states.get(day) ?? "rest");
          const cell = CELL[state];
          return (
            <li
              key={day}
              title={`${formatDayWithWeekday(day)}${cell.label ? `: ${cell.label}` : ""}`}
              className={`flex aspect-square items-center justify-center rounded text-sm ${cell.className}`}
            >
              <span className="sr-only">
                {formatDayWithWeekday(day)}
                {cell.label ? `: ${cell.label}` : ""}
              </span>
              <span aria-hidden>{Number(day.slice(8))}</span>
            </li>
          );
        })}
      </ol>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(["done", "missed", "pending", "rest"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-3 rounded ${CELL[s].className}`} /> {CELL[s].label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function TopicTable({ stats, showTests }: { stats: StudentStats; showTests: boolean }) {
  if (stats.topics.length === 0) return <p className="text-muted">Még nincs kiosztott feladat.</p>;
  const rows = [...stats.topics, stats.totals];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            <th className="py-2 pr-3">Témakör</th>
            <th className="px-2 py-2 text-right">Kiosztva</th>
            <th className="px-2 py-2">Beadva</th>
            <th className="px-2 py-2 text-right">Elfogadva</th>
            <th className="px-2 py-2 text-right">Javítandó</th>
            <th className="px-2 py-2 text-right">Késve</th>
            {showTests ? <th className="px-2 py-2 text-right">Teszt helyes</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const isTotal = t.topicId === 0;
            const ratio = t.assigned > 0 ? t.submitted / t.assigned : 0;
            return (
              <tr key={t.topicId} className={isTotal ? "border-t-2 border-rule font-bold" : "border-b border-rule/60"}>
                <td className="py-2 pr-3">{t.topicName}</td>
                <td className="px-2 py-2 text-right">{t.assigned}</td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-20 overflow-hidden rounded bg-grid" aria-hidden>
                      <span className="block h-full bg-ok" style={{ width: `${Math.round(ratio * 100)}%` }} />
                    </span>
                    {t.submitted} ({percent(t.submitted, t.assigned)})
                  </span>
                </td>
                <td className="px-2 py-2 text-right">{t.accepted}</td>
                <td className="px-2 py-2 text-right">{t.needsRevision || ""}</td>
                <td className="px-2 py-2 text-right">{t.late || ""}</td>
                {showTests ? (
                  <td className="px-2 py-2 text-right">
                    {t.testChecked ? `${t.testCorrect}/${t.testChecked} (${percent(t.testCorrect, t.testChecked)})` : ""}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Üres statisztika olyan tanulónak, akinek még nincs adata. */
export const EMPTY_STATS: StudentStats = {
  streak: { current: 0, best: 0, states: new Map() },
  topics: [],
  week: { total: 0, done: 0 },
  totals: {
    topicId: 0,
    topicName: "Összesen",
    assigned: 0,
    submitted: 0,
    accepted: 0,
    needsRevision: 0,
    late: 0,
    testChecked: 0,
    testCorrect: 0,
  },
};
