import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import type { Topic } from "@/lib/tasks";
import { TaskEditor } from "../task-editor";

export const metadata: Metadata = { title: "Új feladat" };

export default async function NewTaskPage() {
  const { supabase } = await requireTeacher();
  const { data } = await supabase.from("topics").select("id, slug, name").order("id");

  return (
    <main className="space-y-6">
      <p>
        <Link href="/tanar/feladatok" className="text-ink underline-offset-4 hover:underline">
          ← Feladatbank
        </Link>
      </p>
      <h1 className="text-3xl font-bold">Új feladat</h1>
      <section className="sheet">
        <TaskEditor
          topics={(data ?? []) as Topic[]}
          initial={{ title: "", topic_id: null, difficulty: 3, requires_image: true, body_md: "", solution_md: "" }}
          figureUrl={null}
          justSaved={false}
        />
      </section>
    </main>
  );
}
