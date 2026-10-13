"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";
import { describeRpcError } from "@/lib/rpc-errors";

export type EditResult = { status: "idle" } | { status: "ok"; message: string } | { status: "error"; message: string };

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Adj meg egy dátumot.");

/** Egy tanuló egy feladatának áthelyezése (és opcionálisan új határidő). */
export async function rescheduleAction(_prev: EditResult, formData: FormData): Promise<EditResult> {
  const { supabase } = await requireTeacher();
  const id = uuid.safeParse(formData.get("student_task_id"));
  const date = dateOnly.safeParse(formData.get("date"));
  const dueRaw = String(formData.get("due_date") ?? "");
  const due = dueRaw ? dateOnly.safeParse(dueRaw) : null;
  if (!id.success) return { status: "error", message: "A feladat nem található." };
  if (!date.success) return { status: "error", message: "Adj meg egy dátumot." };
  if (due && !due.success) return { status: "error", message: "Hibás határidő." };

  const { error } = await supabase.rpc("reschedule_student_task", {
    p_student_task_id: id.data,
    p_date: date.data,
    p_due_date: due?.success ? due.data : null,
  });
  if (error) return { status: "error", message: describeRpcError(error) };

  revalidatePath(`/tanar/kiosztasok/${formData.get("assignment_id")}`);
  return { status: "ok", message: "Áthelyezve." };
}

/** Egy tanuló egy feladatának cseréje másik feladatra (csak beadás előtt). */
export async function swapTaskAction(_prev: EditResult, formData: FormData): Promise<EditResult> {
  const { supabase } = await requireTeacher();
  const id = uuid.safeParse(formData.get("student_task_id"));
  const taskId = uuid.safeParse(formData.get("task_id"));
  if (!id.success) return { status: "error", message: "A feladat nem található." };
  if (!taskId.success) return { status: "error", message: "Válassz feladatot." };

  const { error } = await supabase.rpc("swap_student_task", { p_student_task_id: id.data, p_task_id: taskId.data });
  if (error) return { status: "error", message: describeRpcError(error) };

  revalidatePath(`/tanar/kiosztasok/${formData.get("assignment_id")}`);
  return { status: "ok", message: "Feladat lecserélve." };
}
