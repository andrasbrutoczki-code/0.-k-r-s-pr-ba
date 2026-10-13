import type { Metadata } from "next";
import { requireStudent } from "@/lib/auth/guards";
import { formatDate, formatWeekday } from "@/lib/dates";

export const metadata: Metadata = { title: "Mai feladat" };

/**
 * A tanuló kezdőlapja. Az 1. lépésben még csak a keret: a „Mai feladat”
 * lista, a korábbi és nyitott feladatok a 3. lépésben kerülnek ide.
 */
export default async function StudentHome() {
  // A layout kliensoldali navigációnál nem fut újra, ezért minden oldal maga is őriz.
  await requireStudent();
  const today = new Date();

  return (
    <main className="space-y-6">
      <section className="sheet space-y-2" aria-labelledby="today-title">
        <h1 id="today-title" className="text-2xl font-bold">
          Mai feladat
        </h1>
        <p className="text-muted">
          {formatDate(today)}, {formatWeekday(today)}
        </p>
        <p className="pt-2">
          Ma még nincs kiosztott feladatod. Amint a tanárod kioszt egyet, itt találod.
        </p>
      </section>
    </main>
  );
}
