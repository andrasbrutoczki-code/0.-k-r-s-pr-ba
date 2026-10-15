import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import { loadTopics } from "@/lib/topics";
import { TaskEditor } from "../task-editor";

export const metadata: Metadata = { title: "Új feladat" };

export default async function NewTaskPage() {
  const { supabase } = await requireTeacher();
  const topics = await loadTopics(supabase);

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
          topics={topics}
          initial={{
            title: "",
            topic_ids: [],
            level: "erettsegi",
            difficulty: 3,
            requires_image: true,
            task_type: "kifejtos",
            est_minutes: null,
            body_md: "",
            solution_md: "",
            correct_choice: "",
          }}
          figureUrl={null}
          justSaved={false}
        />
      </section>
    </main>
  );
}
