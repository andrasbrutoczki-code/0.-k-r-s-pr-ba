import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/dates";
import { formatDayWithWeekday, todayInBudapest } from "@/lib/schedule";
import { TASK_TYPE_LABEL, type TaskType } from "@/lib/task-types";
import { TEACHER_STATUS_LABEL, type TaskStatus } from "@/lib/tasks";
import { StatusBadge } from "@/components/status-badge";
import { Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Ellenőrzés" };

const PAGE_SIZE = 100;
const STATUSES = Object.keys(TEACHER_STATUS_LABEL) as TaskStatus[];

interface Row {
  id: string;
  student_id: string;
  scheduled_date: string;
  due_date: string;
  status: TaskStatus;
  is_late: boolean;
  last_submitted_at: string | null;
  students: { display_name: string } | null;
  tasks: { title: string; task_type: TaskType } | null;
  messages: { author_id: string; read_at: string | null }[];
}

const SELECT =
  "id, student_id, scheduled_date, due_date, status, is_late, last_submitted_at, students(display_name), tasks(title, task_type), messages(author_id, read_at)";

function unreadCount(row: Row): number {
  return row.messages.filter((m) => m.author_id === row.student_id && !m.read_at).length;
}

function ReviewLink({ row, children }: { row: Row; children: React.ReactNode }) {
  return (
    <Link href={`/tanar/ellenorzes/${row.id}`} className="font-bold text-ink underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

type SearchParams = Promise<{ tanulo?: string; allapot?: string; oldal?: string; jovo?: string }>;

/**
 * Áttekintő: minden tanuló minden kiosztott feladata egy szűrhető táblázatban.
 * Felül külön blokkban az ellenőrzésre várók (a legrégebbi beadás elöl) és az
 * olvasatlan tanulói üzenetek – ez a tanár napi teendőlistája.
 */
export default async function ReviewOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireTeacher();
  const params = await searchParams;
  const today = todayInBudapest();
  const page = Math.max(1, Number.parseInt(params.oldal ?? "1", 10) || 1);
  const showFuture = params.jovo === "1";

  const [{ data: students }, { data: todoData }, { data: unreadData }] = await Promise.all([
    supabase.from("students").select("id, display_name").order("display_name"),
    supabase
      .from("student_tasks")
      .select(SELECT)
      .eq("status", "submitted")
      .order("last_submitted_at", { ascending: true })
      .limit(200),
    supabase
      .from("messages")
      .select("student_task_id")
      .is("read_at", null)
      .limit(500),
  ]);
  const todo = (todoData ?? []) as unknown as Row[];

  // Olvasatlan üzenetek olyan feladatoknál, amelyek nincsenek az ellenőrzésre várók között.
  const unreadTaskIds = [...new Set(((unreadData ?? []) as { student_task_id: string }[]).map((m) => m.student_task_id))]
    .filter((id) => !todo.some((t) => t.id === id));
  const { data: unreadRowsData } = unreadTaskIds.length
    ? await supabase.from("student_tasks").select(SELECT).in("id", unreadTaskIds)
    : { data: [] };
  const unreadRows = ((unreadRowsData ?? []) as unknown as Row[]).filter((r) => unreadCount(r) > 0);

  let query = supabase
    .from("student_tasks")
    .select(SELECT, { count: "exact" })
    .order("scheduled_date", { ascending: false })
    .order("position");
  if (params.tanulo && /^[0-9a-f-]{36}$/i.test(params.tanulo)) query = query.eq("student_id", params.tanulo);
  if (STATUSES.includes(params.allapot as TaskStatus)) query = query.eq("status", params.allapot!);
  if (!showFuture) query = query.lte("scheduled_date", today);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "oldal") next.set(key, value);
    if (target > 1) next.set("oldal", String(target));
    const qs = next.toString();
    return qs ? `/tanar/ellenorzes?${qs}` : "/tanar/ellenorzes";
  };

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Ellenőrzés</h1>
        <p className="text-muted">{formatDayWithWeekday(today)}</p>
      </header>

      <section aria-labelledby="todo-title" className="sheet space-y-3">
        <h2 id="todo-title" className="text-xl font-bold text-redpen">
          Ellenőrzésre vár ({todo.length})
        </h2>
        {todo.length === 0 ? (
          <p className="text-muted">Nincs ellenőrzésre váró beadás.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {todo.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  <ReviewLink row={row}>{row.students?.display_name}: {row.tasks?.title}</ReviewLink>
                  <span className="ml-2 text-sm text-muted">
                    {row.tasks ? TASK_TYPE_LABEL[row.tasks.task_type].toLowerCase() : ""}
                    {unreadCount(row) ? `, ${unreadCount(row)} új üzenet` : ""}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  beadva: {row.last_submitted_at ? formatDateTime(row.last_submitted_at) : "?"}
                  {row.is_late ? ", késve" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unreadRows.length > 0 ? (
          <div className="space-y-2 border-t border-rule pt-3">
            <h3 className="font-bold">Új üzenet a tanulóktól</h3>
            <ul className="space-y-1">
              {unreadRows.map((row) => (
                <li key={row.id}>
                  <ReviewLink row={row}>{row.students?.display_name}: {row.tasks?.title}</ReviewLink>
                  <span className="ml-2 text-sm text-muted">{unreadCount(row)} új üzenet</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="all-title" className="space-y-4">
        <h2 id="all-title" className="text-xl font-bold">
          Minden feladat
        </h2>
        <form className="grid gap-3 rounded-md border border-rule bg-sheet p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" role="search">
          <label className="space-y-1">
            <span className="block text-sm font-bold">Tanuló</span>
            <select name="tanulo" defaultValue={params.tanulo ?? ""} className="block min-h-12 w-full rounded-md border border-rule bg-sheet px-3">
              <option value="">Mindenki</option>
              {((students ?? []) as { id: string; display_name: string }[]).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-bold">Állapot</span>
            <select name="allapot" defaultValue={params.allapot ?? ""} className="block min-h-12 w-full rounded-md border border-rule bg-sheet px-3">
              <option value="">Mind</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TEACHER_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-2">
            <input type="checkbox" name="jovo" value="1" defaultChecked={showFuture} className="h-5 w-5" />
            Jövőbeli napok is
          </label>
          <button className="min-h-12 rounded-md bg-ink px-5 font-bold text-white">Szűrés</button>
        </form>

        {error ? <Notice tone="error">A feladatok nem tölthetők be.</Notice> : null}
        {!error && rows.length === 0 ? <p className="text-muted">Nincs a szűrésnek megfelelő feladat.</p> : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-rule bg-sheet">
            <table className="w-full min-w-[40rem] text-left">
              <thead className="border-b border-rule text-sm text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-bold">Nap</th>
                  <th scope="col" className="px-3 py-2 font-bold">Tanuló</th>
                  <th scope="col" className="px-3 py-2 font-bold">Feladat</th>
                  <th scope="col" className="px-3 py-2 font-bold">Állapot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((row) => (
                  <tr key={row.id} className={row.status === "submitted" ? "bg-redpen-soft/60" : ""}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm">{formatDayWithWeekday(row.scheduled_date)}</td>
                    <td className="px-3 py-2">{row.students?.display_name}</td>
                    <td className="px-3 py-2">
                      <ReviewLink row={row}>{row.tasks?.title}</ReviewLink>
                      {unreadCount(row) ? <span className="ml-2 text-sm text-redpen">{unreadCount(row)} új üzenet</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} audience="teacher" late={row.is_late} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {pageCount > 1 ? (
          <nav aria-label="Lapozás" className="flex items-center justify-between gap-4">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="inline-flex min-h-12 items-center font-bold text-ink">
                ← Előző oldal
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} className="inline-flex min-h-12 items-center font-bold text-ink">
                Következő oldal →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </main>
  );
}
