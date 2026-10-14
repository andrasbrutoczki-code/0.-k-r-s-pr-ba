import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/dates";
import { formatDayWithWeekday } from "@/lib/schedule";
import { TASK_TYPE_LABEL, type TaskType } from "@/lib/task-types";
import type { TaskStatus } from "@/lib/tasks";
import { MathText } from "@/components/math-text";
import { StatusBadge } from "@/components/status-badge";
import { Difficulty } from "@/components/ui";
import { ImageViewer } from "./image-viewer";
import { OpenOnMount, ReviewPanel } from "./review-panel";
import type { AiReview } from "./ai-panel";

export const metadata: Metadata = { title: "Ellenőrzés" };

const SIGNED_URL_SECONDS = 60 * 60;
/** Egyezik az Edge Function korlátjával (supabase/functions/ai-review). */
const MAX_AI_REVIEWS_PER_SUBMISSION = 3;

interface ReviewRow {
  id: string;
  student_id: string;
  scheduled_date: string;
  due_date: string;
  status: TaskStatus;
  is_late: boolean;
  students: { display_name: string } | null;
  tasks: {
    title: string;
    body_md: string;
    task_type: TaskType;
    difficulty: number;
    figure_path: string | null;
    task_topics: { topics: { name: string; sort_order: number; retired: boolean } | null }[];
    task_solutions:
      | { solution_md: string; correct_choice: string | null }
      | { solution_md: string; correct_choice: string | null }[]
      | null;
  } | null;
  submissions: {
    id: string;
    version: number;
    submitted_at: string | null;
    choice: string | null;
    answer_text: string | null;
    submission_images: { id: string; storage_path: string; position: number }[];
  }[];
  messages: { id: string; author_id: string; body_md: string; created_at: string }[];
}

/**
 * Egy beadás ellenőrzése. Bal oldalon a feladat és a megoldási útmutató,
 * jobb oldalon a tanuló beadása (nagyítható fotók), a visszajelzés és a döntés,
 * alatta az időbélyeges üzenetszál.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireTeacher();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data } = await supabase
    .from("student_tasks")
    .select(
      `id, student_id, scheduled_date, due_date, status, is_late,
       students(display_name),
       tasks(title, body_md, task_type, difficulty, figure_path, task_topics(topics(name, sort_order, retired)), task_solutions(solution_md, correct_choice)),
       submissions(id, version, submitted_at, choice, answer_text, submission_images(id, storage_path, position)),
       messages(id, author_id, body_md, created_at)`,
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as ReviewRow | null;
  if (!row || !row.tasks) notFound();
  const task = row.tasks;

  const submitted = row.submissions.filter((s) => s.submitted_at).sort((a, b) => b.version - a.version);
  const imagePaths = submitted.flatMap((s) => s.submission_images.map((i) => i.storage_path));
  const latestSubmission = submitted[0];
  const [imageSigned, figureSigned, nextRes, aiRes] = await Promise.all([
    imagePaths.length
      ? supabase.storage.from("submissions").createSignedUrls(imagePaths, SIGNED_URL_SECONDS)
      : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
    task.figure_path
      ? supabase.storage.from("task-figures").createSignedUrl(task.figure_path, SIGNED_URL_SECONDS)
      : Promise.resolve({ data: null }),
    supabase
      .from("student_tasks")
      .select("id")
      .eq("status", "submitted")
      .neq("id", id)
      .order("last_submitted_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string }>(),
    latestSubmission
      ? supabase
          .from("ai_reviews")
          .select("id, created_at, model, result")
          .eq("submission_id", latestSubmission.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const aiReviews = (aiRes.data ?? []) as AiReview[];
  const urlByPath = new Map((imageSigned.data ?? []).map((d) => [d.path, d.signedUrl] as const));
  const figureUrl = figureSigned.data?.signedUrl ?? null;
  const solution = Array.isArray(task.task_solutions) ? task.task_solutions[0] : task.task_solutions;
  const messages = [...row.messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const nextId = nextRes.data?.id;

  return (
    <main className="space-y-6">
      <OpenOnMount id={row.id} />

      <nav className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/tanar/ellenorzes" className="text-ink underline-offset-4 hover:underline">
          ← Ellenőrzés
        </Link>
        {nextId ? (
          <Link href={`/tanar/ellenorzes/${nextId}`} className="font-bold text-ink underline-offset-4 hover:underline">
            Következő ellenőrzésre váró →
          </Link>
        ) : null}
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold">
          {row.students?.display_name}: {task.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          <StatusBadge status={row.status} audience="teacher" late={row.is_late} />
          <span>
            {task.task_topics
              .map((tt) => tt.topics)
              .filter((t): t is NonNullable<typeof t> => !!t && !t.retired)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((t) => t.name)
              .join(", ")}
            , {TASK_TYPE_LABEL[task.task_type].toLowerCase()}
          </span>
          <Difficulty value={task.difficulty} />
          <span>
            {formatDayWithWeekday(row.scheduled_date)}, határidő: {formatDayWithWeekday(row.due_date)}
          </span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="sheet space-y-4" aria-label="A feladat">
          <h2 className="font-bold text-muted">Feladat</h2>
          <MathText source={task.body_md} />
          {figureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL
            <img src={figureUrl} alt="A feladat ábrája" className="max-h-80 rounded-md border border-rule bg-white" />
          ) : null}
          {solution?.solution_md || solution?.correct_choice ? (
            <details open className="border-t border-rule pt-3">
              <summary className="cursor-pointer font-bold text-redpen">Megoldási útmutató</summary>
              {solution.correct_choice ? (
                <p className="mt-2">
                  Helyes válasz: <strong>{solution.correct_choice}</strong>
                </p>
              ) : null}
              {solution.solution_md ? <MathText source={solution.solution_md} className="mt-2" /> : null}
            </details>
          ) : null}
        </section>

        <section className="sheet space-y-5" aria-label="A beadás">
          {submitted.length === 0 ? (
            <p className="text-muted">Még nincs beadott változat.</p>
          ) : (
            submitted.map((version, i) => {
              const images = [...version.submission_images]
                .sort((a, b) => a.position - b.position)
                .map((img) => ({ id: img.id, url: urlByPath.get(img.storage_path) ?? "" }))
                .filter((img) => img.url);
              const body = (
                <div className="space-y-3">
                  {version.choice ? (
                    <p className="flex flex-wrap items-center gap-2">
                      Választott válasz: <strong className="text-2xl">{version.choice}</strong>
                      {solution?.correct_choice ? (
                        version.choice === solution.correct_choice ? (
                          <span className="rounded bg-ok px-2 py-0.5 text-sm font-bold text-white">✓ helyes</span>
                        ) : (
                          <span className="rounded bg-redpen px-2 py-0.5 text-sm font-bold text-white">
                            ✗ hibás, a helyes válasz: {solution.correct_choice}
                          </span>
                        )
                      ) : (
                        <span className="text-sm text-muted">(a feladatnál nincs megadva helyes válasz)</span>
                      )}
                    </p>
                  ) : null}
                  {version.answer_text ? (
                    <div className="rounded-md bg-paper p-3">
                      <p className="mb-1 text-xs font-bold text-muted">
                        {task.task_type === "teszt" ? "Indoklás" : "Válasz"}
                      </p>
                      <MathText source={version.answer_text} />
                    </div>
                  ) : null}
                  <ImageViewer images={images} />
                </div>
              );
              return i === 0 ? (
                <div key={version.id} className="space-y-2">
                  <h2 className="font-bold">
                    {submitted.length > 1 ? `${version.version}. változat (legújabb)` : "A beadás"}
                    <span className="ml-2 font-normal text-muted">
                      {version.submitted_at ? formatDateTime(version.submitted_at) : ""}
                    </span>
                  </h2>
                  {body}
                </div>
              ) : (
                <details key={version.id} className="border-t border-rule pt-3">
                  <summary className="cursor-pointer text-ink">
                    {version.version}. változat, {version.submitted_at ? formatDateTime(version.submitted_at) : ""}
                  </summary>
                  <div className="mt-2">{body}</div>
                </details>
              );
            })
          )}

          <div className="border-t border-rule pt-4">
            <ReviewPanel
              id={row.id}
              status={row.status}
              ai={
                latestSubmission
                  ? {
                      initial: aiReviews[0] ?? null,
                      remaining: Math.max(0, MAX_AI_REVIEWS_PER_SUBMISSION - aiReviews.length),
                    }
                  : null
              }
            />
          </div>
        </section>
      </div>

      <section className="sheet space-y-3" aria-labelledby="thread-title">
        <h2 id="thread-title" className="text-xl font-bold">
          Üzenetek
        </h2>
        {messages.length === 0 ? (
          <p className="text-muted">Még nincs üzenet ennél a feladatnál.</p>
        ) : (
          <ol className="space-y-2">
            {messages.map((m) => {
              const fromStudent = m.author_id === row.student_id;
              return (
                <li
                  key={m.id}
                  className={`rounded-md border p-3 ${fromStudent ? "border-ink/30 bg-ink-soft" : "ml-6 border-redpen/40 bg-redpen-soft"}`}
                >
                  <p className="mb-1 text-xs font-bold text-muted">
                    {fromStudent ? row.students?.display_name : "Te"}, {formatDateTime(m.created_at)}
                  </p>
                  <MathText source={m.body_md} />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
