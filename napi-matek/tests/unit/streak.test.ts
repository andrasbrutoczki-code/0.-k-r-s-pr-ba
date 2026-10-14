import { describe, expect, it } from "vitest";
import { calendarWeeks, computeStreak, type DailyRow, type WeeklyRow } from "../../src/lib/stats/streak.ts";

// 2026-10-05 hétfő … 2026-10-11 vasárnap, 2026-10-12 hétfő …
const d = (day: string, scheduled: number, submitted: number): DailyRow => ({ day, scheduled, submitted });
const w = (week_start: string, total: number, done: number): WeeklyRow => ({ week_start, total, done_by_saturday: done });

describe("sorozat", () => {
  it("minden hétköznap beadott, a szombat is számít, ha a hét kész", () => {
    const daily = ["05", "06", "07", "08", "09"].map((n) => d(`2026-10-${n}`, 2, 2));
    const r = computeStreak(daily, [w("2026-10-05", 10, 10)], "2026-10-11");
    expect(r.current).toBe(6);
    expect(r.best).toBe(6);
    expect(r.states.get("2026-10-10")).toBe("done");
    expect(r.states.get("2026-10-11")).toBe("rest");
  });

  it("kihagyott nap megszakít; a szombat nem számít, ha maradt pótolnivaló, de nem is szakít", () => {
    const daily = [
      d("2026-10-05", 2, 2),
      d("2026-10-06", 2, 0), // kedd kimaradt
      d("2026-10-07", 2, 1),
      d("2026-10-08", 2, 1),
      d("2026-10-09", 2, 1),
    ];
    const r = computeStreak(daily, [w("2026-10-05", 10, 7)], "2026-10-12");
    expect(r.states.get("2026-10-06")).toBe("missed");
    expect(r.states.get("2026-10-10")).toBe("rest");
    expect(r.current).toBe(3);
    expect(r.best).toBe(3);
  });

  it("feladat nélküli nap semleges; beadás feladat nélküli hétköznapon is számít", () => {
    const daily = [d("2026-10-05", 1, 1), d("2026-10-07", 0, 1)];
    const r = computeStreak(daily, [w("2026-10-05", 1, 1)], "2026-10-08");
    expect(r.states.get("2026-10-06")).toBe("rest");
    expect(r.current).toBe(2);
  });

  it("a mai nap, amíg tart, nem szakít meg", () => {
    const daily = [d("2026-10-12", 2, 2), d("2026-10-13", 2, 0)];
    const r = computeStreak(daily, [w("2026-10-12", 10, 2)], "2026-10-13");
    expect(r.states.get("2026-10-13")).toBe("pending");
    expect(r.current).toBe(1);
  });

  it("a vasárnapi beadás nem számít bele", () => {
    const r = computeStreak([d("2026-10-11", 0, 3)], [], "2026-10-11");
    expect(r.current).toBe(0);
  });

  it("nincs adat", () => {
    expect(computeStreak([], [], "2026-10-14")).toEqual({ current: 0, best: 0, states: new Map() });
  });
});

describe("naptár", () => {
  it("az utolsó hetek hétfőtől vasárnapig, a mai nap az utolsó sorban", () => {
    const weeks = calendarWeeks("2026-10-14", 2);
    expect(weeks[0]![0]).toBe("2026-10-05");
    expect(weeks[1]![0]).toBe("2026-10-12");
    expect(weeks[1]![6]).toBe("2026-10-18");
  });
});
