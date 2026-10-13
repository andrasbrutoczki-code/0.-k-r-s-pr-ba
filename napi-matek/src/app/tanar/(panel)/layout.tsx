import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";

/**
 * A tanári felület kerete. A (panel) útvonalcsoport miatt a /tanar/belepes
 * kívül esik ezen a layouton, így ott nincs őr (különben végtelen átirányítás).
 * A menü a lépések előrehaladtával bővül (feladatbank, munkalapok, áttekintő).
 */
const nav = [{ href: "/tanar/tanulok", label: "Tanulók" }];

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  await requireTeacher();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/tanar" className="text-lg font-bold text-redpen">
            Napi matek – tanár
          </Link>
          <nav aria-label="Tanári menü" className="flex gap-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-12 items-center font-bold text-ink underline-offset-4 hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action="/kilepes?ki=tanar" method="post" className="ml-auto">
            <button className="min-h-12 px-2 text-muted underline-offset-4 hover:underline">
              Kilépés
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
