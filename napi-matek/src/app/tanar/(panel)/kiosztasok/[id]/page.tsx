import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guards";
import { formatDateOnly, formatDayWithWeekday } from "@/lib/schedule";
import { TEACHER_STATUS_LABEL, type TaskStatus } from "@/lib/tasks";
import { StudentTaskEdit } from "./student-task-edit";

export const metadata: Metadata = { title: "Kiosztás" };

interface StudentTaskRow {
  id: string;
  student_id: string;
  scheduled_date: string;
  due_date: string;
  status: TaskStatus;
  position: number;
  students: { display_name: string } | null;
  tasks: { title: string } | null;
}

const EDITABLE: TaskStatus[] = ["not_started", "needs_revision"];

/**
 * Egy kiosztás ütemezése tanulónként, a tanulónkénti módosításokkal
 * (áthelyezés, határidő, feladatcsere). A módosítás csak az adott tanulót érinti.
 */
export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireTeacher();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [assignmentRes, rowsRes, tasksRes] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, start_date, worksheet_id, worksheets(title)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("student_tasks")
      .select("id, student_id, scheduled_date, due_date, status, position, students(display_name), tasks(title)")
      .eq("assignment_id", id)
      .order("scheduled_date")
      .order("position"),
    supabase.from("tasks").select("id, title").is("archived_at", null).order("title"),
  ]);

  const assignment = assignmentRes.data as unknown as {
    id: string;
    start_date: string;
    worksheet_id: string;
    worksheets: { title: string } | null;
  } | null;
  if (!assignment) notFound();

  const rows = (rowsRes.data ?? []) as unknown as StudentTaskRow[];
  const tasks = (tasksRes.data ?? []) as { id: string; title: string }[];

  // Tanulónként csoportosítva, név szerint rendezve.
  const byStudent = new Map<string, { name: string; rows: StudentTaskRow[] }>();
  for (const row of rows) {
    const entry = byStudent.get(row.student_id) ?? { name: row.students?.display_name ?? "?", rows: [] };
    entry.rows.push(row);
    byStudent.set(row.student_id, entry);
  }
  const groups = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, "hu"));

  return (
    <main className="space-y-8">
      <p>
        <Link href={`/tanar/munkalapok/${assignment.worksheet_id}`} className="text-ink underline-offset-4 hover:underline">
          ← {assignment.worksheets?.title ?? "Munkalap"}
        </Link>
      </p>
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Kiosztás: {assignment.worksheets?.title}</h1>
        <p className="text-muted">
          Kezdőnap: {formatDateOnly(assignment.start_date)}. A tanulók mindig csak a mai és a korábbi napok
          feladatait látják.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.name} className="sheet space-y-3" aria-label={group.name}>
          <h2 className="text-xl font-bold">{group.name}</h2>
          <ul className="divide-y divide-rule">
            {group.rows.map((row) => (
              <li key={row.id} className="grid gap-2 py-3 md:grid-cols-[12rem_1fr_11rem] md:items-start">
                <div>
                  <p className="font-bold">{formatDayWithWeekday(row.scheduled_date)}</p>
                  <p className="text-sm text-muted">határidő: {formatDayWithWeekday(row.due_date)}</p>
                </div>
                <div>
                  <p>{row.tasks?.title}</p>
                  {EDITABLE.includes(row.status) ? (
                    <StudentTaskEdit
                      assignmentId={assignment.id}
                      studentTaskId={row.id}
                      date={row.scheduled_date}
                      dueDate={row.due_date}
                      canSwap={row.status === "not_started"}
                      tasks={tasks}
                    />
                  ) : null}
                </div>
                <p className={`text-sm font-bold ${row.status === "submitted" ? "text-redpen" : "text-muted"}`}>
                  {TEACHER_STATUS_LABEL[row.status]}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
