/**
 * Hétgenerátor: egy gyakorlási hét (H–P + szombati ismétlés) feladatsorának
 * javaslata a feladatbankból, időkeret alapján.
 *
 * Tiszta függvény (a véletlenszám-forrás paraméter), így determinisztikusan
 * tesztelhető, és a „Új javaslat” gomb csak egy új magot ad.
 *
 * Szabályok
 *   - Minden hétköznapra kb. `minutesPerDay` percnyi feladat (legfeljebb +tolerancia).
 *   - A témakörök napról napra forognak: a nap „fő” témaköréből válogat először,
 *     utána a többiből, így a hét változatos, de egy-egy nap fókuszált.
 *   - Ha több típus van kiválasztva, egy napon belül váltakoznak (pl. teszt, kifejtős, teszt).
 *   - Egy feladat a héten legfeljebb egyszer szerepel.
 *   - Szombat (ha kérik): ismétlés a hét témaköreiből, a kért nehézségi sáv alsó feléből.
 *   - Ha kevés a feladat, a nap rövidebb lesz – erről figyelmeztetést adunk.
 */

import { estimateMinutes, type TaskType } from "./task-types.ts";

export interface PoolTask {
  id: string;
  title: string;
  topicId: number;
  difficulty: number;
  type: TaskType;
  /** Megadott becsült idő (perc), vagy null → becslés típus és nehézség alapján. */
  estMinutes: number | null;
}

export interface GeneratorOptions {
  topicIds: number[];
  types: TaskType[];
  difficultyMin: number;
  difficultyMax: number;
  minutesPerDay: number;
  saturdayReview: boolean;
  /** 0 ≤ random() < 1 */
  random: () => number;
}

export interface PlannedTask {
  taskId: string;
  title: string;
  topicId: number;
  difficulty: number;
  type: TaskType;
  minutes: number;
}

export interface PlannedDay {
  dayNo: number; // 1 = hétfő … 6 = szombat
  tasks: PlannedTask[];
  minutes: number;
}

export interface WeekPlan {
  days: PlannedDay[];
  warnings: string[];
}

/** Ennyi perccel léphető túl a napi keret, ha különben üres maradna a hely. */
const TOLERANCE_MINUTES = 5;

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function toPlanned(task: PoolTask): PlannedTask {
  return {
    taskId: task.id,
    title: task.title,
    topicId: task.topicId,
    difficulty: task.difficulty,
    type: task.type,
    minutes: estimateMinutes(task.type, task.difficulty, task.estMinutes),
  };
}

/** Típusonként váltakozó sorrend: [t1, k1, t2, k2, …] a megadott típusok szerint. */
function interleaveByType(tasks: PlannedTask[], types: TaskType[], startIndex: number): PlannedTask[] {
  if (types.length < 2) return tasks;
  const queues = types.map((type) => tasks.filter((t) => t.type === type));
  const result: PlannedTask[] = [];
  let i = startIndex;
  while (queues.some((q) => q.length > 0)) {
    const queue = queues[i % queues.length]!;
    const next = queue.shift();
    if (next) result.push(next);
    i += 1;
  }
  return result;
}

/** Egy nap kitöltése a jelöltekből az időkeretig; a felhasznált azonosítókat jelöli. */
function fillDay(candidates: PlannedTask[], budget: number, used: Set<string>): PlannedTask[] {
  const picked: PlannedTask[] = [];
  let total = 0;
  for (const task of candidates) {
    if (used.has(task.taskId)) continue;
    const limit = picked.length === 0 ? budget + TOLERANCE_MINUTES : budget;
    if (total + task.minutes <= limit) {
      picked.push(task);
      used.add(task.taskId);
      total += task.minutes;
    }
    if (budget - total < 2) break; // a legrövidebb feladat is kb. 2 perc
  }
  return picked;
}

export function planWeek(pool: PoolTask[], options: GeneratorOptions): WeekPlan {
  const { topicIds, types, difficultyMin, difficultyMax, minutesPerDay, random } = options;
  const warnings: string[] = [];

  const eligible = shuffle(
    pool.filter(
      (t) =>
        topicIds.includes(t.topicId) &&
        types.includes(t.type) &&
        t.difficulty >= difficultyMin &&
        t.difficulty <= difficultyMax,
    ),
    random,
  ).map(toPlanned);

  if (eligible.length === 0) {
    return { days: [], warnings: ["A megadott feltételeknek egyetlen feladat sem felel meg."] };
  }

  const used = new Set<string>();
  const days: PlannedDay[] = [];
  const topicOrder = shuffle(topicIds, random);

  for (let dayNo = 1; dayNo <= 5; dayNo++) {
    const mainTopic = topicOrder[(dayNo - 1) % topicOrder.length];
    const ordered = [
      ...interleaveByType(eligible.filter((t) => t.topicId === mainTopic), types, dayNo),
      ...interleaveByType(eligible.filter((t) => t.topicId !== mainTopic), types, dayNo),
    ];
    const tasks = fillDay(ordered, minutesPerDay, used);
    days.push({ dayNo, tasks, minutes: tasks.reduce((s, t) => s + t.minutes, 0) });
  }

  if (options.saturdayReview) {
    // Ismétlés: a hét témaköreiből, a nehézségi sáv alsó feléből, még nem használt feladatokkal.
    const weekTopics = new Set(days.flatMap((d) => d.tasks.map((t) => t.topicId)));
    const reviewMax = Math.max(difficultyMin, Math.floor((difficultyMin + difficultyMax) / 2));
    const reviewPool = interleaveByType(
      eligible.filter((t) => weekTopics.has(t.topicId) && t.difficulty <= reviewMax),
      types,
      6,
    );
    const tasks = fillDay(reviewPool, minutesPerDay, used);
    days.push({ dayNo: 6, tasks, minutes: tasks.reduce((s, t) => s + t.minutes, 0) });
    if (tasks.length === 0) warnings.push("Szombatra nem maradt könnyebb, még nem használt feladat ezekből a témakörökből.");
  }

  const short = days.filter((d) => d.tasks.length > 0 && d.minutes < minutesPerDay * 0.7);
  const empty = days.filter((d) => d.tasks.length === 0 && d.dayNo <= 5);
  if (empty.length > 0) {
    warnings.push(`Elfogyott a feladat: ${empty.length} hétköznapra nem jutott feladat. Bővítsd a témaköröket, típusokat vagy a nehézségi sávot.`);
  } else if (short.length > 0) {
    warnings.push(`${short.length} napon a keretnél jóval kevesebb jutott (kevés a megfelelő feladat).`);
  }

  return { days, warnings };
}

/** Determinisztikus véletlenszám-generátor (mulberry32) – a „mag” ugyanazt a javaslatot adja. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
