import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import { formatDateOnly, nextMonday, todayInBudapest } from "@/lib/schedule";
import type { Topic } from "@/lib/tasks";
import { estimateMinutes, type TaskType } from "@/lib/task-types";
import { Button, Notice } from "@/components/ui";
import { deleteWorksheetAction } from "../actions";
import {
  AssignPanel,
  DuplicateButtons,
  ItemsEditor,
  TaskPicker,
  WeekGenerator,
  WorksheetMetaForm,
  type EditorItem,
  type PickerTask,
} from "./worksheet-editor";

export const metadata: Metadata = { title: "Munkalap" };

interface ItemRow {
  id: string;
  position: number;
  week_no: number;
  day_no: number;
  tasks: { id: string; title: string; difficulty: number; topic_id: number; archived_at: string | null };
}

interface AssignmentRow {
  id: string;
  start_date: string;
  student_tasks: { students: { display_name: string } | null }[];
}

export default async function WorksheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ visszavonva?: string; megmaradt?: string }>;
}) {
  const { supabase } = await requireTeacher();
  const { id } = await params;
  const revoked = await searchParams;
  const removedCount = Number(revoked.visszavonva);
  const keptCount = Number(revoked.megmaradt);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [worksheetRes, itemsRes, tasksRes, topicsRes, studentsRes, assignmentsRes] = await Promise.all([
    supabase.from("worksheets").select("id, title, description, is_template").eq("id", id).maybeSingle<{
      id: string;
      title: string;
      description: string | null;
      is_template: boolean;
    }>(),
    supabase
      .from("worksheet_items")
      .select("id, position, week_no, day_no, tasks(id, title, difficulty, topic_id, archived_at)")
      .eq("worksheet_id", id)
      .order("position"),
    supabase
      .from("tasks")
      .select("id, title, difficulty, topic_id, task_type, est_minutes")
      .is("archived_at", null)
      .order("title")
      .limit(5000),
    supabase.from("topics").select("id, slug, name").order("id"),
    supabase.from("students").select("id, display_name").is("disabled_at", null).order("display_name"),
    supabase
      .from("assignments")
      .select("id, start_date, student_tasks(students(display_name))")
      .eq("worksheet_id", id)
      .order("start_date", { ascending: false }),
  ]);

  const worksheet = worksheetRes.data;
  if (!worksheet) notFound();

  const topics = (topicsRes.data ?? []) as Topic[];
  const topicName = new Map(topics.map((t) => [t.id, t.name]));

  const items: EditorItem[] = ((itemsRes.data ?? []) as unknown as ItemRow[]).map((row) => ({
    id: row.id,
    position: row.position,
    week_no: row.week_no,
    day_no: row.day_no,
    task: {
      id: row.tasks.id,
      title: row.tasks.title,
      difficulty: row.tasks.difficulty,
      topicName: topicName.get(row.tasks.topic_id) ?? "",
      archived: Boolean(row.tasks.archived_at),
    },
  }));

  const pickerTasks: PickerTask[] = ((tasksRes.data ?? []) as {
    id: string;
    title: string;
    difficulty: number;
    topic_id: number;
    task_type: TaskType;
    est_minutes: number | null;
  }[]).map((t) => ({
    id: t.id,
    title: t.title,
    difficulty: t.difficulty,
    topicId: t.topic_id,
    type: t.task_type,
    minutes: estimateMinutes(t.task_type, t.difficulty, t.est_minutes),
  }));

  // A generátorhoz: témakörönként hány aktív feladat van.
  const topicCounts = new Map<number, number>();
  for (const t of pickerTasks) topicCounts.set(t.topicId, (topicCounts.get(t.topicId) ?? 0) + 1);
  const nextWeek = items.length ? Math.min(10, Math.max(...items.map((i) => i.week_no)) + 1) : 1;

  const students = ((studentsRes.data ?? []) as { id: string; display_name: string }[]).map((s) => ({
    id: s.id,
    name: s.display_name,
  }));

  const assignments = ((assignmentsRes.data ?? []) as unknown as AssignmentRow[]).map((a) => ({
    id: a.id,
    startDate: a.start_date,
    names: [...new Set(a.student_tasks.map((st) => st.students?.display_name).filter(Boolean))] as string[],
  }));

  return (
    <main className="space-y-8">
      <p>
        <Link href="/tanar/munkalapok" className="text-ink underline-offset-4 hover:underline">
          ← Munkalapok
        </Link>
      </p>

      {revoked.visszavonva !== undefined && Number.isFinite(removedCount) ? (
        <Notice tone={keptCount > 0 ? "warning" : "success"}>
          Kiosztás visszavonva: {removedCount} feladat törölve.
          {keptCount > 0
            ? ` ${keptCount} feladat megmaradt, mert a tanuló már elkezdte, beadta vagy üzenetet írt hozzá; ezeket a kiosztás oldalán látod.`
            : ""}
        </Notice>
      ) : null}

      <header className="space-y-1">
        <h1 className="text-3xl font-bold">{worksheet.title}</h1>
        <p className="text-muted">
          {worksheet.is_template ? "Sablon. " : ""}
          {items.length} feladat
        </p>
      </header>

      <section className="sheet space-y-4" aria-labelledby="items-title">
        <h2 id="items-title" className="text-xl font-bold">
          Feladatok és ütemezés
        </h2>
        <p className="text-sm text-muted">
          A nap a kiosztás kezdőnapjához képest értendő (hétfői kezdésnél a napnevek egyeznek). Feladat csak
          hétfőtől péntekig kerül ki: a szombat a hét elmaradt feladatainak pótlónapja, vasárnap szünnap.
          Egy napra több feladat is kerülhet.
        </p>
        <ItemsEditor worksheetId={worksheet.id} items={items} />
      </section>

      <section className="sheet space-y-4" aria-labelledby="assign-title">
        <h2 id="assign-title" className="text-xl font-bold">
          Kiosztás
        </h2>
        <AssignPanel
          worksheetId={worksheet.id}
          students={students}
          defaultStart={nextMonday(todayInBudapest())}
          items={items}
        />
        {assignments.length > 0 ? (
          <div className="space-y-2 border-t border-rule pt-4">
            <h3 className="font-bold">Korábbi kiosztások</h3>
            <ul className="space-y-1">
              {assignments.map((a) => (
                <li key={a.id}>
                  <Link href={`/tanar/kiosztasok/${a.id}`} className="font-bold text-ink underline-offset-4 hover:underline">
                    {formatDateOnly(a.startDate)}-tól
                  </Link>
                  <span className="text-muted">: {a.names.join(", ") || "nincs tanuló"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="sheet space-y-4" aria-labelledby="generator-title">
        <h2 id="generator-title" className="text-xl font-bold">
          Hét összeállítása automatikusan
        </h2>
        <p className="text-sm text-muted">
          A generátor hétfőtől péntekig minden napra a napi időkeretnyi feladatot javasol a kiválasztott témakörökből, nehézségi
          sávból és típusokból; a témakörök napról napra forognak. Előbb megnézed a javaslatot, és csak a
          jóváhagyás után kerül a munkalapra.
        </p>
        <WeekGenerator
          worksheetId={worksheet.id}
          topics={topics.map((t) => ({ id: t.id, name: t.name, count: topicCounts.get(t.id) ?? 0 }))}
          defaultWeek={nextWeek}
        />
      </section>

      <section className="sheet space-y-4" aria-labelledby="picker-title">
        <h2 id="picker-title" className="text-xl font-bold">
          Feladat kézi hozzáadása a feladatbankból
        </h2>
        <TaskPicker
          worksheetId={worksheet.id}
          tasks={pickerTasks}
          topics={topics.map((t) => ({ id: t.id, name: t.name }))}
          usedTaskIds={items.map((i) => i.task.id)}
        />
      </section>

      <section className="sheet space-y-6" aria-labelledby="settings-title">
        <h2 id="settings-title" className="text-xl font-bold">
          Beállítások
        </h2>
        <WorksheetMetaForm id={worksheet.id} title={worksheet.title} description={worksheet.description ?? ""} />
        <DuplicateButtons worksheetId={worksheet.id} isTemplate={worksheet.is_template} />
        {assignments.length === 0 ? (
          <form action={deleteWorksheetAction}>
            <input type="hidden" name="id" value={worksheet.id} />
            <Button type="submit" variant="danger">
              Munkalap törlése
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted">Kiosztott munkalap nem törölhető; a tanulók feladatai hivatkoznak rá.</p>
        )}
      </section>
    </main>
  );
}
