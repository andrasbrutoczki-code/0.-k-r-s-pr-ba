/**
 * Ütemezési segédfüggvények: a gyakorlási hét (H–Szo) és a dátum-csak
 * („YYYY-MM-DD”) értékek kezelése. Függőség nélküli, tesztelhető kód.
 *
 * A „YYYY-MM-DD” értékeket naptári napként kezeljük, nem időpontként: a
 * számításokat UTC-ben végezzük, így a böngésző/szerver időzónája nem
 * csúsztathatja el a napot.
 */

/** A gyakorlási hét napjai (1 = hétfő … 6 = szombat). Vasárnap szünnap. */
export const PRACTICE_DAYS = ["hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"] as const;

/** „1. hét, kedd” */
export function describeSlot(weekNo: number, dayNo: number): string {
  return `${weekNo}. hét, ${PRACTICE_DAYS[dayNo - 1] ?? "?"}`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO hét napja: 1 = hétfő … 7 = vasárnap. */
export function isoWeekday(value: string): number {
  const day = parseDateOnly(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

/** A mai nap Budapesten, „YYYY-MM-DD” alakban. */
export function todayInBudapest(now: Date = new Date()): string {
  // Az en-CA locale „YYYY-MM-DD” formát ad.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A kiosztás alapértelmezett kezdőnapja: a következő hétfő (ha ma hétfő, akkor ma). */
export function nextMonday(today: string): string {
  const weekday = isoWeekday(today);
  return weekday === 1 ? today : addDays(today, 8 - weekday);
}

/** Egy tétel napja a kiosztás kezdő hétfőjéhez képest – ugyanaz, mint az SQL-ben. */
export function scheduledDate(startMonday: string, weekNo: number, dayNo: number): string {
  return addDays(startMonday, 7 * (weekNo - 1) + (dayNo - 1));
}

const dateOnlyFmt = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "long",
});

const dateOnlyLongFmt = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "UTC",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** „október 13., kedd” */
export function formatDayWithWeekday(value: string): string {
  return dateOnlyFmt.format(parseDateOnly(value));
}

/** „2026. október 13.” */
export function formatDateOnly(value: string): string {
  return dateOnlyLongFmt.format(parseDateOnly(value));
}
