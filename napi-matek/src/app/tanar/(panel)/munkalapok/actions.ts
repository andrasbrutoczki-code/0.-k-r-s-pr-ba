"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";
import { describeRpcError } from "@/lib/rpc-errors";

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
  day: z.number().int().min(1).max(6),
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
  if (!startDate.success) return { status: "error", message: "Adj meg egy kezdőnapot (hétfő)." };
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
