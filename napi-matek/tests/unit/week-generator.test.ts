import { describe, expect, it } from "vitest";
import { planWeek, seededRandom, type PoolTask } from "../../src/lib/week-generator.ts";
import { estimateMinutes, inferTaskType, parseTaskType } from "../../src/lib/task-types.ts";

/** Kitalált bank: 2 témakör × (40 teszt + 15 kifejtős), nehézség 1–5 körbe. */
function makePool(): PoolTask[] {
  const pool: PoolTask[] = [];
  for (const topicId of [1, 2]) {
    for (let i = 0; i < 40; i++) {
      pool.push({ id: `t${topicId}-${i}`, title: `T${i}`, topicId, difficulty: (i % 5) + 1, type: "teszt", estMinutes: null });
    }
    for (let i = 0; i < 15; i++) {
      pool.push({ id: `k${topicId}-${i}`, title: `K${i}`, topicId, difficulty: (i % 5) + 1, type: "kifejtos", estMinutes: null });
    }
  }
  return pool;
}

const base = {
  topicIds: [1, 2],
  types: ["teszt", "kifejtos"] as const,
  difficultyMin: 1,
  difficultyMax: 3,
  minutesPerDay: 30,
};

describe("típusok és időbecslés", () => {
  it("becsült idő típus és nehézség szerint, a megadott érték elsőbbséget kap", () => {
    expect(estimateMinutes("teszt", 1)).toBe(2);
    expect(estimateMinutes("rovid", 3)).toBe(8);
    expect(estimateMinutes("kifejtos", 5)).toBe(30);
    expect(estimateMinutes("kifejtos", 5, 12)).toBe(12);
  });

  it("típus felismerése", () => {
    expect(inferTaskType("Mennyi?\n(A) 1\n(B) 2", false)).toBe("teszt");
    expect(inferTaskType("Mennyi?", false)).toBe("rovid");
    expect(inferTaskType("Igazolja!", true)).toBe("kifejtos");
    expect(parseTaskType("Feleletválasztós")).toBe("teszt");
    expect(parseTaskType("rövid válasz")).toBe("rovid");
    expect(parseTaskType("Kifejtős")).toBe("kifejtos");
    expect(parseTaskType("valami")).toBeNull();
  });
});

describe("hétgenerátor", () => {
  it("H–P minden napra jut feladat, a keret (+5 perc) nem lépi túl, szombatra nem tesz", () => {
    const plan = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(1) });
    expect(plan.days.map((d) => d.dayNo)).toEqual([1, 2, 3, 4, 5]);
    for (const day of plan.days) {
      expect(day.tasks.length > 0).toBe(true);
      expect(day.minutes <= 35).toBe(true);
      expect(day.minutes >= 20).toBe(true);
    }
    expect(plan.warnings).toEqual([]);
  });

  it("a feltételeket betartja, és egy feladat csak egyszer szerepel", () => {
    const plan = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(7) });
    const all = plan.days.flatMap((d) => d.tasks);
    expect(new Set(all.map((t) => t.taskId)).size).toBe(all.length);
    expect(all.every((t) => t.difficulty >= 1 && t.difficulty <= 3)).toBe(true);
  });

  it("vegyes típusnál egy napon belül is keveredik a teszt és a kifejtős", () => {
    const plan = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(11) });
    const mixedDays = plan.days.filter((d) => new Set(d.tasks.map((t) => t.type)).size > 1);
    expect(mixedDays.length >= 3).toBe(true);
  });

  it("ugyanaz a mag ugyanazt adja, más mag mást", () => {
    const a = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(5) });
    const b = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(5) });
    const c = planWeek(makePool(), { ...base, types: [...base.types], random: seededRandom(6) });
    const ids = (p: typeof a) => p.days.flatMap((d) => d.tasks.map((t) => t.taskId)).join();
    expect(ids(a)).toBe(ids(b));
    expect(ids(a) === ids(c)).toBe(false);
  });

  it("kevés feladatnál figyelmeztet, üres feltételnél jelzi", () => {
    const tiny = makePool().slice(0, 3);
    const plan = planWeek(tiny, { ...base, types: ["teszt"], topicIds: [1], random: seededRandom(1) });
    expect(plan.warnings.length > 0).toBe(true);
    const none = planWeek(makePool(), { ...base, types: ["rovid"], random: seededRandom(1) });
    expect(none.days).toEqual([]);
  });
});

import { choiceLetters } from "../../src/lib/task-types.ts";

describe("teszt válaszlehetőségei", () => {
  it("a szövegben szereplő betűjelek, különben A–D", () => {
    expect(choiceLetters("?\n(A) 1\n(B) 2\n(C) 3")).toEqual(["A", "B", "C"]);
    expect(choiceLetters("(E) x (A) y (D) z")).toEqual(["A", "D", "E"]);
    expect(choiceLetters("nincs")).toEqual(["A", "B", "C", "D"]);
  });
});
