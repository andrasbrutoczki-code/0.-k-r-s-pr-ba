import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/lib/auth/guards";
import type { TaskListItem, Topic } from "@/lib/tasks";
import { MathText } from "@/components/math-text";
import { Difficulty, Notice } from "@/components/ui";
import { TASK_TYPES, TASK_TYPE_LABEL, estimateMinutes, type TaskType } from "@/lib/task-types";

export const metadata: Metadata = { title: "Feladatbank" };

interface TaskRow extends TaskListItem {
  worksheet_items: { count: number }[];
}

type SearchParams = Promise<{
  tema?: string;
  nehezseg?: string;
  tipus?: string;
  q?: string;
  archiv?: string;
  oldal?: string;
}>;

/** Egy oldalon ennyi feladat: több száz feladatnál is gyors marad a lista. */
const PAGE_SIZE = 50;

/**
 * Feladatbank: szűrhető lista. A szűrők GET-paraméterek, így a szűrt nézet
 * linkelhető és a böngésző „vissza” gombja is működik.
 */
export default async function TaskBankPage({ searchParams }: { searchParams: SearchParams }) {
  const { supabase } = await requireTeacher();
  const params = await searchParams;
  const showArchived = params.archiv === "1";

  const { data: topicData } = await supabase.from("topics").select("id, slug, name").order("id");
  const topics = (topicData ?? []) as Topic[];
  const topicById = new Map(topics.map((t) => [t.id, t]));

  let query = supabase
    .from("tasks")
    .select(
      "id, title, body_md, difficulty, requires_image, figure_path, archived_at, topic_id, task_type, est_minutes, worksheet_items(count)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id");

  const topic = topics.find((t) => t.slug === params.tema);
  if (topic) query = query.eq("topic_id", topic.id);
  const difficulty = Number(params.nehezseg);
  if (Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5) query = query.eq("difficulty", difficulty);
  if (TASK_TYPES.includes(params.tipus as TaskType)) query = query.eq("task_type", params.tipus!);
  if (params.q?.trim()) query = query.ilike("title", `%${params.q.trim().replace(/[%_]/g, "\\$&")}%`);
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);

  const page = Math.max(1, Number.parseInt(params.oldal ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  const tasks = (data ?? []) as TaskRow[];
  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Lapozó link a jelenlegi szűrők megtartásával. */
  const pageHref = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "oldal") next.set(key, value);
    if (target > 1) next.set("oldal", String(target));
    const qs = next.toString();
    return qs ? `/tanar/feladatok?${qs}` : "/tanar/feladatok";
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Feladatbank</h1>
          <p className="text-muted">
            {showArchived ? "Archivált feladatok." : "Innen állítod össze a munkalapokat."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/tanar/feladatok/import"
            className="inline-flex min-h-12 items-center rounded-md border border-ink/40 bg-sheet px-5 font-bold text-ink hover:bg-ink-soft"
          >
            Importálás fájlból
          </Link>
          <Link
            href="/tanar/feladatok/uj"
            className="inline-flex min-h-12 items-center rounded-md bg-ink px-5 font-bold text-white hover:bg-ink/90"
          >
            Új feladat
          </Link>
        </div>
      </header>

      <form className="grid gap-3 rounded-md border border-rule bg-sheet p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
        <label className="space-y-1">
          <span className="block text-sm font-bold">Keresés címben</span>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            className="block min-h-12 w-full rounded-md border border-rule px-3"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-bold">Témakör</span>
          <select name="tema" defaultValue={params.tema ?? ""} className="block min-h-12 w-full rounded-md border border-rule bg-sheet px-3">
            <option value="">Mind</option>
            {topics.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-bold">Nehézség</span>
          <select name="nehezseg" defaultValue={params.nehezseg ?? ""} className="block min-h-12 w-full rounded-md border border-rule bg-sheet px-3">
            <option value="">Mind</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-sm font-bold">Típus</span>
          <select name="tipus" defaultValue={params.tipus ?? ""} className="block min-h-12 w-full rounded-md border border-rule bg-sheet px-3">
            <option value="">Mind</option>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {showArchived ? <input type="hidden" name="archiv" value="1" /> : null}
        <button className="min-h-12 self-end rounded-md bg-ink px-5 font-bold text-white">Szűrés</button>
      </form>

      <p className="text-sm">
        {total} feladat{pageCount > 1 ? `, ${page}. oldal / ${pageCount}` : ""}.{" "}
        <Link
          href={showArchived ? "/tanar/feladatok" : "/tanar/feladatok?archiv=1"}
          className="font-bold text-ink underline-offset-4 hover:underline"
        >
          {showArchived ? "Vissza az aktív feladatokhoz" : "Archivált feladatok megtekintése"}
        </Link>
      </p>

      {error ? <Notice tone="error">A feladatok nem tölthetők be.</Notice> : null}
      {!error && tasks.length === 0 ? (
        <p className="text-muted">
          Nincs a szűrésnek megfelelő feladat. Hozz létre újat, vagy importálj fájlból.
        </p>
      ) : null}

      <ul className="space-y-3">
        {tasks.map((task) => {
          const used = task.worksheet_items[0]?.count ?? 0;
          return (
            <li key={task.id} className="rounded-md border border-rule bg-sheet p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link
                  href={`/tanar/feladatok/${task.id}`}
                  className="text-lg font-bold text-ink underline-offset-4 hover:underline"
                >
                  {task.title}
                </Link>
                <Difficulty value={task.difficulty} />
              </div>
              <p className="mt-1 text-sm text-muted">
                {topicById.get(task.topic_id)?.name ?? "?"}, {TASK_TYPE_LABEL[task.task_type].toLowerCase()}, ~
                {estimateMinutes(task.task_type, task.difficulty, task.est_minutes)} perc
                {task.requires_image ? ", fényképpel beadandó" : ""}
                {task.figure_path ? ", ábrával" : ""}
                {used > 0 ? `, ${used} munkalapon` : ""}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-bold text-ink">Feladat szövege</summary>
                <MathText source={task.body_md} className="mt-2" />
              </details>
            </li>
          );
        })}
      </ul>

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
    </main>
  );
}
