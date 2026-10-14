import type { createClient } from "@/lib/supabase/server";
import { addDays, isoWeekday } from "../schedule";
import { computeStreak, type DailyRow, type StreakResult, type WeeklyRow } from "./streak";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Statisztika betöltése az adatbázis összesítőiből (stats_daily, stats_weekly,
 * stats_topics). A függvények RLS alatt futnak: tanulói kliens csak a saját
 * adatait kapja, tanári kliens mindenkiét.
 */

export interface TopicStat {
  topicId: number;
  topicName: string;
  assigned: number;
  submitted: number;
  accepted: number;
  needsRevision: number;
  late: number;
  testChecked: number;
  testCorrect: number;
}

export interface StudentStats {
  streak: StreakResult;
  topics: TopicStat[];
  /** Az aktuális hét (hétfőtől): összes feladat és ebből beadott. */
  week: { total: number; done: number };
  totals: TopicStat;
}

interface TopicRow {
  student_id: string;
  topic_id: number;
  topic_name: string;
  assigned: number;
  submitted: number;
  accepted: number;
  needs_revision: number;
  late: number;
  test_checked: number;
  test_correct: number;
}

function emptyTotals(): TopicStat {
  return {
    topicId: 0,
    topicName: "Összesen",
    assigned: 0,
    submitted: 0,
    accepted: 0,
    needsRevision: 0,
    late: 0,
    testChecked: 0,
    testCorrect: 0,
  };
}

/** Tanulónként csoportosított statisztika (studentId nélkül: mindenki, akit a hívó láthat). */
export async function loadStats(
  supabase: Supabase,
  today: string,
  studentId?: string,
): Promise<Map<string, StudentStats>> {
  const args = { p_student_id: studentId ?? null };
  const [dailyRes, weeklyRes, topicsRes] = await Promise.all([
    supabase.rpc("stats_daily", args),
    supabase.rpc("stats_weekly", args),
    supabase.rpc("stats_topics", args),
  ]);

  const daily = new Map<string, DailyRow[]>();
  for (const r of (dailyRes.data ?? []) as (DailyRow & { student_id: string })[]) {
    daily.set(r.student_id, [...(daily.get(r.student_id) ?? []), r]);
  }
  const weekly = new Map<string, WeeklyRow[]>();
  for (const r of (weeklyRes.data ?? []) as (WeeklyRow & { student_id: string })[]) {
    weekly.set(r.student_id, [...(weekly.get(r.student_id) ?? []), r]);
  }
  const topics = new Map<string, TopicStat[]>();
  for (const r of (topicsRes.data ?? []) as TopicRow[]) {
    topics.set(r.student_id, [
      ...(topics.get(r.student_id) ?? []),
      {
        topicId: r.topic_id,
        topicName: r.topic_name,
        assigned: r.assigned,
        submitted: r.submitted,
        accepted: r.accepted,
        needsRevision: r.needs_revision,
        late: r.late,
        testChecked: r.test_checked,
        testCorrect: r.test_correct,
      },
    ]);
  }

  const thisMonday = addDays(today, 1 - isoWeekday(today));
  const ids = new Set([...daily.keys(), ...weekly.keys(), ...topics.keys()]);
  const result = new Map<string, StudentStats>();
  for (const id of ids) {
    const studentTopics = topics.get(id) ?? [];
    const totals = studentTopics.reduce((sum, t) => {
      sum.assigned += t.assigned;
      sum.submitted += t.submitted;
      sum.accepted += t.accepted;
      sum.needsRevision += t.needsRevision;
      sum.late += t.late;
      sum.testChecked += t.testChecked;
      sum.testCorrect += t.testCorrect;
      return sum;
    }, emptyTotals());
    const week = (weekly.get(id) ?? []).find((w) => w.week_start === thisMonday);
    result.set(id, {
      streak: computeStreak(daily.get(id) ?? [], weekly.get(id) ?? [], today),
      topics: studentTopics,
      week: { total: week?.total ?? 0, done: week?.done_by_saturday ?? 0 },
      totals,
    });
  }
  return result;
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((100 * part) / whole)}%` : "–";
}
