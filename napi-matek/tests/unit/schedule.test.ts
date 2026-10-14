import { describe, expect, it } from "vitest";
import {
  addDays,
  describeSlot,
  formatDayWithWeekday,
  isoWeekday,
  nextMonday,
  scheduledDate,
  todayInBudapest,
} from "../../src/lib/schedule.ts";

describe("ütemezés", () => {
  it("hét napja és következő hétfő", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // hétfő
    expect(isoWeekday("2026-10-18")).toBe(7); // vasárnap
    expect(nextMonday("2026-10-12")).toBe("2026-10-12");
    expect(nextMonday("2026-10-13")).toBe("2026-10-19");
    expect(nextMonday("2026-10-18")).toBe("2026-10-19");
  });

  it("hónap- és évváltás", () => {
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(nextMonday("2027-02-26")).toBe("2027-03-01");
  });

  it("ugyanúgy számol, mint az adatbázis", () => {
    expect(scheduledDate("2026-10-12", 1, 1)).toBe("2026-10-12");
    expect(scheduledDate("2026-10-12", 1, 6)).toBe("2026-10-17");
    expect(scheduledDate("2026-10-12", 2, 1)).toBe("2026-10-19");
  });

  it("bármely napon induló kiosztás: vasárnap kimarad", () => {
    expect(scheduledDate("2026-10-14", 1, 1)).toBe("2026-10-14"); // szerda
    expect(scheduledDate("2026-10-14", 1, 4)).toBe("2026-10-17"); // szombat
    expect(scheduledDate("2026-10-14", 1, 5)).toBe("2026-10-19"); // hétfő
    expect(scheduledDate("2026-10-17", 1, 2)).toBe("2026-10-19"); // szombat → hétfő
  });

  it("magyar megjelenítés", () => {
    expect(describeSlot(1, 2)).toBe("1. hét, kedd");
    expect(formatDayWithWeekday("2026-10-13")).toBe("október 13., kedd");
  });

  it("budapesti mai nap éjfél körül", () => {
    // 2026-10-12 22:30 UTC = 2026-10-13 00:30 Budapesten (CEST, UTC+2)
    expect(todayInBudapest(new Date("2026-10-12T22:30:00Z"))).toBe("2026-10-13");
  });
});
