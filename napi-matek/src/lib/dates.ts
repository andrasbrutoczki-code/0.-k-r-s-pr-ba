/**
 * Magyar dátumformázás, mindig Europe/Budapest időzónában – a szerver
 * (Netlify: UTC) és a böngésző időzónájától függetlenül.
 */

const TZ = "Europe/Budapest";

const dateFmt = new Intl.DateTimeFormat("hu-HU", {
  timeZone: TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("hu-HU", {
  timeZone: TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const weekdayFmt = new Intl.DateTimeFormat("hu-HU", { timeZone: TZ, weekday: "long" });

/** „2026. október 13.” */
export function formatDate(d: Date | string): string {
  return dateFmt.format(new Date(d));
}

/** „2026. október 13. 19:52” */
export function formatDateTime(d: Date | string): string {
  return dateTimeFmt.format(new Date(d));
}

/** „kedd” */
export function formatWeekday(d: Date | string): string {
  return weekdayFmt.format(new Date(d));
}

/** Hány teljes nap van hátra `target`-ig (negatív, ha már elmúlt). */
export function daysUntil(target: Date, now: Date = new Date()): number {
  return Math.floor((target.getTime() - now.getTime()) / 86_400_000);
}
