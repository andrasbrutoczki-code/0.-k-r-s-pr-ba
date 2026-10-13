import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { StudentLoginForm } from "@/components/student-login-form";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Belépés" };

const reasons: Record<string, string> = {
  lejart: "A munkameneted lejárt, vagy a tanárod új kódot adott. Lépj be újra.",
  kilepett: "Kiléptél. Legközelebb a neveddel és a kódoddal léphetsz be.",
};

export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  // Aki már bent van, ne lássa újra a belépést (lejártnál a /kilepes már kiléptette).
  const session = await getSessionUser();
  if (session?.role === "student") redirect("/tanulo");

  const { ok } = await searchParams;
  const reason = ok ? reasons[ok] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="sheet space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold text-ink">Napi matek</h1>
          <p className="text-muted">Lépj be a neveddel és a tanárodtól kapott kóddal.</p>
        </header>

        {reason ? <Notice>{reason}</Notice> : null}

        <StudentLoginForm />
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        Tanár vagy?{" "}
        <Link href="/tanar/belepes" className="font-bold text-ink underline-offset-4 hover:underline">
          Tanári belépés
        </Link>
      </p>
    </main>
  );
}
