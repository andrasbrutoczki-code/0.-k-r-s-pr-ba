import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";

/**
 * A tanári felület kerete. A (panel) útvonalcsoport miatt a /tanar/belepes
 * kívül esik ezen a layouton, így ott nincs őr (különben végtelen átirányítás).
 * Az „Ellenőrzés” menüpont jelvénye az ellenőrzésre váró beadások és az
 * olvasatlan tanulói üzenetek száma.
 */
const nav = [
  { href: "/tanar/ellenorzes", label: "Ellenőrzés" },
  { href: "/tanar/tanulok", label: "Tanulók" },
  { href: "/tanar/feladatok", label: "Feladatbank" },
  { href: "/tanar/munkalapok", label: "Munkalapok" },
  { href: "/tanar/biztatasok", label: "Biztató üzenetek" },
];

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await requireTeacher();
  // Jelvény: ellenőrzésre váró beadások + olvasatlan tanulói üzenetek.
  const { data: counts } = await supabase
    .rpc("review_counts")
    .maybeSingle<{ to_review: number; unread_messages: number }>();
  const badge = (counts?.to_review ?? 0) + (counts?.unread_messages ?? 0);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-sheet">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/tanar" className="text-lg font-bold text-redpen">
            Napi matek – tanár
          </Link>
          <nav aria-label="Tanári menü" className="flex flex-wrap gap-x-5">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-12 items-center font-bold text-ink underline-offset-4 hover:underline"
              >
                {item.label}
                {item.href === "/tanar/ellenorzes" && badge > 0 ? (
                  <span
                    className="ml-1.5 inline-flex min-w-6 items-center justify-center rounded-full bg-redpen px-1.5 text-sm text-white"
                    aria-label={`${badge} teendő`}
                  >
                    {badge}
                  </span>
                ) : null}
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
