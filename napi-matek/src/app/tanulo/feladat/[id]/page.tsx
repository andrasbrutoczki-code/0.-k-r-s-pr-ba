import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudent } from "@/lib/auth/guards";
import { loadTaskDetails } from "@/lib/student/tasks";
import { TaskCard } from "../../task-card";

export const metadata: Metadata = { title: "Feladat" };

/** Egy feladat külön oldalon (a nyitott és korábbi feladatok listájából). */
export default async function StudentTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await requireStudent();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Az RLS miatt más tanuló vagy a jövőbeli nap feladata egyszerűen nem jön vissza.
  const [task] = await loadTaskDetails(supabase, user.id, [id]);
  if (!task) notFound();

  return (
    <main className="space-y-4">
      <p>
        <Link href="/tanulo" className="text-ink underline-offset-4 hover:underline">
          ← Vissza a mai feladathoz
        </Link>
      </p>
      <TaskCard task={task} studentId={user.id} headingLevel={2} />
    </main>
  );
}
