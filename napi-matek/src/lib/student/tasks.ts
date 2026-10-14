import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TaskStatus } from "@/lib/tasks";
import { choiceLetters, estimateMinutes, type TaskType } from "@/lib/task-types";

/**
 * A tanulói felület adatai. Minden lekérdezés a tanuló saját kliensével fut,
 * így az RLS garantálja, hogy csak a saját, mai vagy korábbi feladatait látja.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Aláírt képhivatkozások élettartama: egy oldalbetöltéshez és némi olvasáshoz elég. */
const SIGNED_URL_SECONDS = 60 * 30;

export interface TaskSummary {
  id: string;
  scheduledDate: string;
  dueDate: string;
  status: TaskStatus;
  isLate: boolean;
  title: string;
  type: TaskType;
  minutes: number;
  topicName: string;
}

export interface SubmissionImage {
  id: string;
  path: string;
  url: string | null;
}

export interface SubmissionVersion {
  id: string;
  version: number;
  submittedAt: string | null;
  choice: string | null;
  answerText: string | null;
  images: SubmissionImage[];
}

export interface ThreadMessage {
  id: string;
  fromTeacher: boolean;
  body: string;
  createdAt: string;
}

export interface TaskDetail extends TaskSummary {
  body: string;
  difficulty: number;
  requiresImage: boolean;
  figureUrl: string | null;
  letters: string[];
  /** Beadott verziók, a legújabb elöl. */
  versions: SubmissionVersion[];
  /** A még be nem adott vázlat (feltöltött képekkel), ha van. */
  draft: SubmissionVersion | null;
  messages: ThreadMessage[];
  editable: boolean;
}

interface SummaryRow {
  id: string;
  scheduled_date: string;
  due_date: string;
  status: TaskStatus;
  is_late: boolean;
  tasks: {
    title: string;
    task_type: TaskType;
    difficulty: number;
    est_minutes: number | null;
    task_topics: TaskTopicRow[];
  } | null;
}

type TaskTopicRow = { topics: { name: string; sort_order: number; retired: boolean } | null };

/** A feladat témakörei vesszővel, a témakörlista sorrendjében (visszavontak nélkül). */
function topicLabel(rows: TaskTopicRow[] | undefined): string {
  return (rows ?? [])
    .map((r) => r.topics)
    .filter((t): t is NonNullable<TaskTopicRow["topics"]> => !!t && !t.retired)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => t.name)
    .join(", ");
}

function toSummary(row: SummaryRow): TaskSummary {
  const task = row.tasks;
  return {
    id: row.id,
    scheduledDate: row.scheduled_date,
    dueDate: row.due_date,
    status: row.status,
    isLate: row.is_late,
    title: task?.title ?? "Feladat",
    type: task?.task_type ?? "kifejtos",
    minutes: task ? estimateMinutes(task.task_type, task.difficulty, task.est_minutes) : 0,
    topicName: topicLabel(task?.task_topics),
  };
}

/** Az összes látható feladat röviden (a listákhoz), dátum szerint csökkenő sorrendben. */
export async function loadTaskSummaries(supabase: Supabase): Promise<TaskSummary[]> {
  const { data } = await supabase
    .from("student_tasks")
    .select("id, scheduled_date, due_date, status, is_late, tasks(title, task_type, difficulty, est_minutes, task_topics(topics(name, sort_order, retired)))")
    .order("scheduled_date", { ascending: false })
    .order("position")
    .limit(500);
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary);
}

interface DetailRow extends SummaryRow {
  tasks: SummaryRow["tasks"] & { body_md: string; requires_image: boolean; figure_path: string | null };
  submissions: {
    id: string;
    version: number;
    submitted_at: string | null;
    choice: string | null;
    answer_text: string | null;
    submission_images: { id: string; storage_path: string; position: number; created_at: string }[];
  }[];
  messages: { id: string; author_id: string; body_md: string; created_at: string }[];
}

/** Aláírt URL-ek egy bucketből, egyetlen kéréssel. */
async function signPaths(supabase: Supabase, bucket: string, paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_SECONDS);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
  }
  return result;
}

/** Teljes adatok a megadott feladatokhoz (szöveg, ábra, verziók, üzenetek). */
export async function loadTaskDetails(supabase: Supabase, studentId: string, ids: string[]): Promise<TaskDetail[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("student_tasks")
    .select(
      `id, scheduled_date, due_date, status, is_late,
       tasks(title, task_type, difficulty, est_minutes, body_md, requires_image, figure_path, task_topics(topics(name, sort_order, retired))),
       submissions(id, version, submitted_at, choice, answer_text, submission_images(id, storage_path, position, created_at)),
       messages(id, author_id, body_md, created_at)`,
    )
    .in("id", ids);
  const rows = (data ?? []) as unknown as DetailRow[];

  const figurePaths = rows.map((r) => r.tasks?.figure_path).filter((p): p is string => Boolean(p));
  const imagePaths = rows.flatMap((r) => r.submissions.flatMap((s) => s.submission_images.map((i) => i.storage_path)));
  const [figureUrls, imageUrls] = await Promise.all([
    signPaths(supabase, "task-figures", figurePaths),
    signPaths(supabase, "submissions", imagePaths),
  ]);

  const toVersion = (s: DetailRow["submissions"][number]): SubmissionVersion => ({
    id: s.id,
    version: s.version,
    submittedAt: s.submitted_at,
    choice: s.choice,
    answerText: s.answer_text,
    images: [...s.submission_images]
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
      .map((i) => ({ id: i.id, path: i.storage_path, url: imageUrls.get(i.storage_path) ?? null })),
  });

  const details = rows.map((row): TaskDetail => {
    const summary = toSummary(row);
    const body = row.tasks?.body_md ?? "";
    const versions = row.submissions
      .filter((s) => s.submitted_at)
      .sort((a, b) => b.version - a.version)
      .map(toVersion);
    const draftRow = row.submissions.find((s) => !s.submitted_at);
    return {
      ...summary,
      body,
      difficulty: row.tasks?.difficulty ?? 1,
      requiresImage: row.tasks?.requires_image ?? false,
      figureUrl: row.tasks?.figure_path ? (figureUrls.get(row.tasks.figure_path) ?? null) : null,
      letters: choiceLetters(body),
      versions,
      draft: draftRow ? toVersion(draftRow) : null,
      messages: [...row.messages]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((m) => ({ id: m.id, fromTeacher: m.author_id !== studentId, body: m.body_md, createdAt: m.created_at })),
      editable: summary.status === "not_started" || summary.status === "needs_revision",
    };
  });

  // A kért sorrendben adjuk vissza.
  const byId = new Map(details.map((d) => [d.id, d]));
  return ids.map((id) => byId.get(id)).filter((d): d is TaskDetail => Boolean(d));
}
