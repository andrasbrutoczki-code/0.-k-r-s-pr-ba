import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import type { TaskListItem } from "@/lib/tasks";
import { loadTopics, topicIdsOf } from "@/lib/topics";
import { formatDate } from "@/lib/dates";
import { Button, Notice } from "@/components/ui";
import { TaskEditor } from "../task-editor";
import { setTaskArchivedAction } from "../actions";

export const metadata: Metadata = { title: "Feladat szerkesztése" };

/** Az aláírt ábra-URL élettartama: elég egy szerkesztési menetre. */
const SIGNED_URL_SECONDS = 60 * 30;

export default async function EditTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mentve?: string }>;
}) {
  const { supabase } = await requireTeacher();
  const { id } = await params;
  const { mentve } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: task }, { data: solution }, topics, { data: taskTopics }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, body_md, difficulty, requires_image, figure_path, archived_at, topic_id, task_type, est_minutes, level")
      .eq("id", id)
      .maybeSingle<TaskListItem>(),
    supabase
      .from("task_solutions")
      .select("solution_md, correct_choice")
      .eq("task_id", id)
      .maybeSingle<{ solution_md: string; correct_choice: string | null }>(),
    loadTopics(supabase),
    supabase.from("task_topics").select("topic_id").eq("task_id", id),
  ]);
  if (!task) notFound();

  let figureUrl: string | null = null;
  if (task.figure_path) {
    const { data } = await supabase.storage.from("task-figures").createSignedUrl(task.figure_path, SIGNED_URL_SECONDS);
    figureUrl = data?.signedUrl ?? null;
  }

  return (
    <main className="space-y-6">
      <p>
        <Link href="/tanar/feladatok" className="text-ink underline-offset-4 hover:underline">
          ← Feladatbank
        </Link>
      </p>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">{task.title}</h1>
        <form action={setTaskArchivedAction}>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="archived" value={task.archived_at ? "false" : "true"} />
          <Button type="submit" variant={task.archived_at ? "secondary" : "danger"}>
            {task.archived_at ? "Visszaállítás" : "Archiválás"}
          </Button>
        </form>
      </header>

      {task.archived_at ? (
        <Notice tone="warning">
          Archiválva: {formatDate(task.archived_at)}. Új munkalapra nem tehető, a korábbi kiosztásokban megmarad.
        </Notice>
      ) : null}

      <section className="sheet">
        <TaskEditor
          topics={topics}
          initial={{
            id: task.id,
            title: task.title,
            level: task.level,
            // Az elsődleges témakör elöl, utána a többi a lista sorrendjében.
            topic_ids: [
              task.topic_id,
              ...topicIdsOf(taskTopics as { topic_id: number }[] | null, topics).filter((t) => t !== task.topic_id),
            ].filter((t) => topics.some((x) => x.id === t)),
            difficulty: task.difficulty,
            requires_image: task.requires_image,
            task_type: task.task_type,
            est_minutes: task.est_minutes,
            body_md: task.body_md,
            solution_md: solution?.solution_md ?? "",
            correct_choice: solution?.correct_choice ?? "",
          }}
          figureUrl={figureUrl}
          justSaved={mentve === "1"}
        />
      </section>
    </main>
  );
}
