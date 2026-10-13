import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { TeacherLoginForm } from "./teacher-login-form";

export const metadata: Metadata = { title: "Tanári belépés" };

export default async function TeacherLoginPage() {
  const session = await getSessionUser();
  if (session?.role === "teacher") redirect("/tanar");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="sheet space-y-6">
        <header className="space-y-1">
          <h1 className="text-3xl font-bold text-redpen">Tanári belépés</h1>
          <p className="text-muted">Napi matek</p>
        </header>
        <TeacherLoginForm />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Tanuló vagy?{" "}
        <Link href="/belepes" className="font-bold text-ink underline-offset-4 hover:underline">
          Tanulói belépés
        </Link>
      </p>
    </main>
  );
}
