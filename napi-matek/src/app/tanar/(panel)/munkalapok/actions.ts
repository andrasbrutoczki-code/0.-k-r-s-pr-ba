"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";
import { describeRpcError } from "@/lib/rpc-errors";
import type { TaskType } from "@/lib/task-types";
import { planWeek, seededRandom, type PoolTask, type WeekPlan } from "@/lib/week-generator";

const uuid = z.string().uuid();
const titleSchema = z.string().trim().min(1, "Adj címet a munkalapnak.").max(120);

export type ActionResult = { ok: true } | { ok: false; message: string };

function revalidateWorksheet(worksheetId: string) {
  revalidatePath(`/tanar/munkalapok/${worksheetId}`);
  revalidatePath("/tanar/munkalapok");
}

// -----------------------------------------------------------------------------
// Munkalap
// -----------------------------------------------------------------------------

export async function createWorksheetAction(formData: FormData): Promise<void> {
  const { supabase } = await requireTeacher();
  const title = titleSchema.safeParse(formData.get("title"));
  if (!title.success) return;

  const { data, error } = await supabase
    .from("worksheets")
    .insert({ title: title.data, is_template: formData.get("is_template") === "on" })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return;
  redirect(`/tanar/munkalapok/${data.id}`);
}

export async function updateWorksheetAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  const id = uuid.safeParse(formData.get("id"));
  const title = titleSchema.safeParse(formData.get("title"));
  if (!id.success) return { ok: false, message: "A munkalap nem található." };
  if (!title.success) return { ok: false, message: title.error.issues[0]?.message ?? "Hibás cím." };

  const description = String(formData.get("description") ?? "").trim().slice(0, 2000) || null;
  const { error } = await supabase
    .from("worksheets")
    .update({ title: title.data, description, updated_at: new Date().toISOString() })
    .eq("id", id.data);
  if (error) return { ok: false, message: "A mentés nem sikerült." };
  revalidateWorksheet(id.data);
  return { ok: true };
}

/** Csak kiosztás nélküli munkalap törölhető (a kiosztások idegen kulcsa is védi). */
export async function deleteWorksheetAction(formData: FormData): Promise<void> {
  const { supabase } = await requireTeacher();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  const { error } = await supabase.from("worksheets").delete().eq("id", id.data);
  if (!error) {
    revalidatePath("/tanar/munkalapok");
    redirect("/tanar/munkalapok");
  }
}

export async function duplicateWorksheetAction(worksheetId: string, asTemplate: boolean): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(worksheetId).success) return { ok: false, message: "A munkalap nem található." };

  const { data, error } = await supabase.rpc("duplicate_worksheet", {
    p_worksheet_id: worksheetId,
    p_as_template: asTemplate,
    p_title: null,
  });
  if (error || typeof data !== "string") return { ok: false, message: describeRpcError(error) };
  revalidatePath("/tanar/munkalapok");
  redirect(`/tanar/munkalapok/${data}`);
}

// -----------------------------------------------------------------------------
// Tételek
// -----------------------------------------------------------------------------

export async function addItemAction(worksheetId: string, taskId: string): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(worksheetId).success || !uuid.safeParse(taskId).success) {
    return { ok: false, message: "Hibás azonosító." };
  }
  const { error } = await supabase.rpc("add_worksheet_item", { p_worksheet_id: worksheetId, p_task_id: taskId });
  if (error) return { ok: false, message: describeRpcError(error) };
  revalidateWorksheet(worksheetId);
  return { ok: true };
}

export async function moveItemAction(worksheetId: string, itemId: string, direction: -1 | 1): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(itemId).success) return { ok: false, message: "Hibás azonosító." };
  const { error } = await supabase.rpc("move_worksheet_item", { p_item_id: itemId, p_direction: direction });
  if (error) return { ok: false, message: describeRpcError(error) };
  revalidateWorksheet(worksheetId);
  return { ok: true };
}

export async function removeItemAction(worksheetId: string, itemId: string): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(itemId).success) return { ok: false, message: "Hibás azonosító." };
  const { error } = await supabase.from("worksheet_items").delete().eq("id", itemId);
  if (error) return { ok: false, message: "A tétel nem távolítható el." };
  revalidateWorksheet(worksheetId);
  return { ok: true };
}

const slotSchema = z.object({
  week: z.number().int().min(1).max(20),
  day: z.number().int().min(1).max(5),
});

export async function updateItemSlotAction(
  worksheetId: string,
  itemId: string,
  week: number,
  day: number,
): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  const slot = slotSchema.safeParse({ week, day });
  if (!uuid.safeParse(itemId).success || !slot.success) return { ok: false, message: "Hibás ütemezés." };
  const { error } = await supabase
    .from("worksheet_items")
    .update({ week_no: slot.data.week, day_no: slot.data.day })
    .eq("id", itemId);
  if (error) return { ok: false, message: "Az ütemezés nem menthető." };
  revalidateWorksheet(worksheetId);
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Kiosztás
// -----------------------------------------------------------------------------

export type AssignResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; assignmentId: string; studentCount: number };

/** Csoportos kiosztás: egy művelet, tetszőleges számú tanuló. */
export async function assignWorksheetAction(_prev: AssignResult, formData: FormData): Promise<AssignResult> {
  const { supabase } = await requireTeacher();

  const worksheetId = uuid.safeParse(formData.get("worksheet_id"));
  const startDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(formData.get("start_date"));
  const studentIds = z.array(uuid).safeParse(formData.getAll("student_ids"));
  if (!worksheetId.success) return { status: "error", message: "A munkalap nem található." };
  if (!startDate.success) return { status: "error", message: "Adj meg egy kezdőnapot." };
  if (!studentIds.success || studentIds.data.length === 0) {
    return { status: "error", message: "Válassz legalább egy tanulót." };
  }

  const { data, error } = await supabase.rpc("assign_worksheet", {
    p_worksheet_id: worksheetId.data,
    p_start_date: startDate.data,
    p_student_ids: studentIds.data,
  });
  if (error || typeof data !== "string") return { status: "error", message: describeRpcError(error) };

  revalidateWorksheet(worksheetId.data);
  return { status: "done", assignmentId: data, studentCount: new Set(studentIds.data).size };
}

// -----------------------------------------------------------------------------
// Hétgenerátor
// -----------------------------------------------------------------------------

const generatorSchema = z.object({
  worksheetId: uuid,
  topicIds: z.array(z.number().int().positive()).min(1, "Válassz legalább egy témakört."),
  types: z.array(z.enum(["teszt", "rovid", "kifejtos"])).min(1, "Válassz legalább egy feladattípust."),
  difficultyMin: z.number().int().min(1).max(5),
  difficultyMax: z.number().int().min(1).max(5),
  minutesPerDay: z.number().int().min(5).max(120),
  onlyUnassigned: z.boolean(),
  seed: z.number().int(),
});

export type GeneratorInput = z.infer<typeof generatorSchema>;
export type PreviewResult = { ok: true; plan: WeekPlan; poolSize: number } | { ok: false; message: string };

/**
 * Javaslat egy teljes hétre. Nem ír semmit: a tanár megnézi, újrakérheti
 * (új mag), és csak a jóváhagyás után kerül a munkalapra (applyWeekAction).
 * Kimaradnak a munkalapon már szereplő és – ha kérik – a már kiosztott feladatok.
 */
export async function previewWeekAction(input: GeneratorInput): Promise<PreviewResult> {
  const { supabase } = await requireTeacher();
  const parsed = generatorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Hibás beállítás." };
  const opts = parsed.data;
  if (opts.difficultyMin > opts.difficultyMax) {
    return { ok: false, message: "A legkisebb nehézség nem lehet nagyobb a legnagyobbnál." };
  }

  const { data, error } = await supabase.rpc("generator_pool", {
    p_worksheet_id: opts.worksheetId,
    p_topic_ids: opts.topicIds,
    p_types: opts.types,
    p_difficulty_min: opts.difficultyMin,
    p_difficulty_max: opts.difficultyMax,
    p_only_unassigned: opts.onlyUnassigned,
  });
  if (error) return { ok: false, message: describeRpcError(error) };

  const pool: PoolTask[] = (
    (data ?? []) as {
      id: string;
      title: string;
      /** Az új adatbázis-függvény összes témakört ad; a régi csak egyet. */
      topic_ids?: number[] | null;
      topic_id?: number;
      difficulty: number;
      task_type: TaskType;
      est_minutes: number | null;
    }[]
  ).map((t) => ({
    id: t.id,
    title: t.title,
    topicIds: t.topic_ids ?? (t.topic_id ? [t.topic_id] : []),
    difficulty: t.difficulty,
    type: t.task_type,
    estMinutes: t.est_minutes,
  }));

  // Az adatbázis véletlen sorrendben adja a jelölteket; azonosító szerint rendezve
  // ugyanaz a „mag” ugyanabból a halmazból ugyanazt a javaslatot adja.
  pool.sort((x, y) => x.id.localeCompare(y.id));
  const plan = planWeek(pool, { ...opts, random: seededRandom(opts.seed) });
  return { ok: true, plan, poolSize: pool.length };
}

/** A jóváhagyott javaslat felvétele a munkalapra, egy tranzakcióban. */
export async function applyWeekAction(
  worksheetId: string,
  weekNo: number,
  items: { taskId: string; dayNo: number }[],
): Promise<ActionResult> {
  const { supabase } = await requireTeacher();
  const parsed = z
    .object({
      worksheetId: uuid,
      weekNo: z.number().int().min(1).max(20),
      items: z.array(z.object({ taskId: uuid, dayNo: z.number().int().min(1).max(5) })).min(1),
    })
    .safeParse({ worksheetId, weekNo, items });
  if (!parsed.success) return { ok: false, message: "Hibás javaslat." };

  const payload = [...parsed.data.items]
    .sort((a, b) => a.dayNo - b.dayNo)
    .map((i) => ({ task_id: i.taskId, week_no: parsed.data.weekNo, day_no: i.dayNo }));

  const { error } = await supabase.rpc("add_worksheet_items_bulk", {
    p_worksheet_id: parsed.data.worksheetId,
    p_items: payload,
  });
  if (error) return { ok: false, message: describeRpcError(error) };
  revalidateWorksheet(parsed.data.worksheetId);
  return { ok: true };
}

export interface TaskPreview {
  body_md: string;
  figureUrl: string | null;
  solution_md: string | null;
  correct_choice: string | null;
}

/** Egy feladat előnézete a munkalap-szerkesztőhöz (lenyitáskor töltődik be). */
export async function getTaskPreviewAction(taskId: string): Promise<TaskPreview | null> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(taskId).success) return null;
  const { data } = await supabase
    .from("tasks")
    .select("body_md, figure_path, task_solutions(solution_md, correct_choice)")
    .eq("id", taskId)
    .maybeSingle();
  const task = data as unknown as {
    body_md: string;
    figure_path: string | null;
    task_solutions:
      | { solution_md: string; correct_choice: string | null }
      | { solution_md: string; correct_choice: string | null }[]
      | null;
  } | null;
  if (!task) return null;
  const solution = Array.isArray(task.task_solutions) ? task.task_solutions[0] : task.task_solutions;
  let figureUrl: string | null = null;
  if (task.figure_path) {
    const { data: signed } = await supabase.storage.from("task-figures").createSignedUrl(task.figure_path, 60 * 30);
    figureUrl = signed?.signedUrl ?? null;
  }
  return {
    body_md: task.body_md,
    figureUrl,
    solution_md: solution?.solution_md || null,
    correct_choice: solution?.correct_choice ?? null,
  };
}
