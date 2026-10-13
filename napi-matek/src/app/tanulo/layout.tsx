import { requireStudent } from "@/lib/auth/guards";
import { daysUntil, formatDate } from "@/lib/dates";
import { StudentLoginForm } from "@/components/student-login-form";

/** Ennyi nappal a lejárat előtt kérjük a kód újbóli megadását. */
const RENEWAL_WINDOW_DAYS = 7;

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const { displayName, expiresAt } = await requireStudent();
  const daysLeft = daysUntil(expiresAt);
  const firstName = displayName.split(" ").at(-1) ?? displayName;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <header className="flex items-center justify-between gap-4 py-4">
        <p className="text-lg font-bold text-ink">Szia, {firstName}!</p>
        <form action="/kilepes" method="post">
          <button className="min-h-12 px-2 text-muted underline-offset-4 hover:underline">
            Kilépés
          </button>
        </form>
      </header>

      {daysLeft < RENEWAL_WINDOW_DAYS ? (
        <section
          aria-labelledby="renewal-title"
          className="mb-6 rounded-md border border-margin bg-sheet p-4"
        >
          <h2 id="renewal-title" className="font-bold">
            {daysLeft <= 0
              ? "A belépésed ma lejár"
              : `A belépésed ${daysLeft} nap múlva lejár (${formatDate(expiresAt)})`}
          </h2>
          <p className="mb-4 text-muted">
            Add meg újra a belépőkódod, és újabb egy évig nem kell foglalkoznod vele. Ha nem
            tudod a kódot, kérj újat a tanárodtól.
          </p>
          <StudentLoginForm lockedName={displayName} submitLabel="Belépés meghosszabbítása" />
        </section>
      ) : null}

      {children}
    </div>
  );
}
