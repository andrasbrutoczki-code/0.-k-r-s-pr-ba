import { addDays, isoWeekday } from "../schedule.ts";

/**
 * Sorozat (streak) kiszámítása az adatbázis napi és heti összesítőiből
 * (stats_daily, stats_weekly). Tiszta függvény, egységtesztelt.
 *
 * Szabály (a tanárral egyeztetve):
 *   - Hétfő–péntek: a nap teljesített, ha a tanuló aznap beadott legalább egy
 *     feladatot. Ha volt ütemezett feladat, de nem adott be, a nap megszakítja
 *     a sorozatot.
 *   - Szombat (pótlónap): akkor teljesített, ha szombat végéig a hét összes
 *     feladata be van adva; különben semleges (nem szakít meg).
 *   - Vasárnap és a feladat nélküli napok semlegesek.
 *   - A mai nap, amíg tart, csak növelheti a sorozatot.
 */

export interface DailyRow {
  day: string;
  scheduled: number;
  submitted: number;
}

export interface WeeklyRow {
  week_start: string;
  total: number;
  done_by_saturday: number;
}

/** done = teljesített, missed = megszakító, pending = ma még nyitott, rest = semleges. */
export type DayState = "done" | "missed" | "pending" | "rest";

export interface StreakResult {
  current: number;
  best: number;
  /** Napi állapot a legkorábbi adatnaptól máig. */
  states: Map<string, DayState>;
}

export function dayState(
  day: string,
  today: string,
  daily: Map<string, DailyRow>,
  weekly: Map<string, WeeklyRow>,
): DayState {
  const weekday = isoWeekday(day);
  if (weekday === 7) return "rest";
  if (weekday === 6) {
    const week = weekly.get(addDays(day, -5));
    return week && week.total > 0 && week.done_by_saturday >= week.total ? "done" : "rest";
  }
  const row = daily.get(day);
  if (row && row.submitted > 0) return "done";
  if (row && row.scheduled > 0) return day === today ? "pending" : "missed";
  return "rest";
}

export function computeStreak(dailyRows: DailyRow[], weeklyRows: WeeklyRow[], today: string): StreakResult {
  const daily = new Map(dailyRows.map((r) => [r.day, r] as const));
  const weekly = new Map(weeklyRows.map((r) => [r.week_start, r] as const));
  const states = new Map<string, DayState>();

  const first = [...dailyRows.map((r) => r.day), ...weeklyRows.map((r) => r.week_start)].sort()[0];
  if (!first) return { current: 0, best: 0, states };

  let run = 0;
  let best = 0;
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const state = dayState(day, today, daily, weekly);
    states.set(day, state);
    if (state === "done") {
      run += 1;
      best = Math.max(best, run);
    } else if (state === "missed") {
      run = 0;
    }
  }
  return { current: run, best, states };
}

/** Az utolsó `weeks` hét napjai hétfőtől vasárnapig, naptárnézethez. */
export function calendarWeeks(today: string, weeks: number): string[][] {
  const monday = addDays(today, 1 - isoWeekday(today));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(monday, (w - weeks + 1) * 7 + d)),
  );
}
