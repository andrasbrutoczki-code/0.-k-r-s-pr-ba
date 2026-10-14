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

// -----------------------------------------------------------------------------
// Hibás kiosztás javítása
// -----------------------------------------------------------------------------

function revalidateAssignment(assignmentId: string) {
  revalidatePath(`/tanar/kiosztasok/${assignmentId}`);
  revalidatePath("/tanar/munkalapok", "layout");
  revalidatePath("/tanar/ellenorzes");
}

export type RevokeResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; removed: number; kept: number; assignmentDeleted: boolean };

/** Visszavonás (egész kiosztás vagy egy tanuló). Csak az érintetlen feladatok törlődnek. */
export async function revokeAssignmentAction(_prev: RevokeResult, formData: FormData): Promise<RevokeResult> {
  const { supabase } = await requireTeacher();
  const assignmentId = uuid.safeParse(formData.get("assignment_id"));
  const studentRaw = String(formData.get("student_id") ?? "");
  const studentId = studentRaw ? uuid.safeParse(studentRaw) : null;
  if (!assignmentId.success || (studentId && !studentId.success)) {
    return { status: "error", message: "A kiosztás nem található." };
  }
  const { data, error } = await supabase.rpc("revoke_assignment", {
    p_assignment_id: assignmentId.data,
    p_student_id: studentId?.success ? studentId.data : null,
  });
  if (error || !data) return { status: "error", message: describeRpcError(error) };
  const result = data as { removed: number; kept: number; assignment_deleted: boolean };
  revalidateAssignment(assignmentId.data);
  return { status: "done", removed: result.removed, kept: result.kept, assignmentDeleted: result.assignment_deleted };
}

/** Egy kiosztott feladat eltávolítása (csak érintetlen). */
export async function removeStudentTaskAction(_prev: EditResult, formData: FormData): Promise<EditResult> {
  const { supabase } = await requireTeacher();
  const id = uuid.safeParse(formData.get("student_task_id"));
  if (!id.success) return { status: "error", message: "A feladat nem található." };
  const { error } = await supabase.rpc("remove_student_task", { p_student_task_id: id.data });
  if (error) return { status: "error", message: describeRpcError(error) };
  revalidateAssignment(String(formData.get("assignment_id")));
  return { status: "ok", message: "Eltávolítva." };
}

/** Az egész kiosztás áthelyezése új kezdőnapra (az el nem kezdett feladatokra). */
export async function moveAssignmentAction(_prev: EditResult, formData: FormData): Promise<EditResult> {
  const { supabase } = await requireTeacher();
  const assignmentId = uuid.safeParse(formData.get("assignment_id"));
  const start = dateOnly.safeParse(formData.get("start_date"));
  if (!assignmentId.success) return { status: "error", message: "A kiosztás nem található." };
  if (!start.success) return { status: "error", message: "Adj meg egy kezdőnapot." };
  const { data, error } = await supabase.rpc("move_assignment", {
    p_assignment_id: assignmentId.data,
    p_start_date: start.data,
  });
  if (error) return { status: "error", message: describeRpcError(error) };
  revalidateAssignment(assignmentId.data);
  return { status: "ok", message: `${Number(data)} feladat új dátumot kapott.` };
}

/** Tanuló(k) hozzáadása a meglévő kiosztáshoz. */
export async function addStudentsAction(_prev: EditResult, formData: FormData): Promise<EditResult> {
  const { supabase } = await requireTeacher();
  const assignmentId = uuid.safeParse(formData.get("assignment_id"));
  const studentIds = z.array(uuid).safeParse(formData.getAll("student_ids"));
  if (!assignmentId.success) return { status: "error", message: "A kiosztás nem található." };
  if (!studentIds.success || studentIds.data.length === 0) return { status: "error", message: "Válassz tanulót." };
  const { data, error } = await supabase.rpc("add_students_to_assignment", {
    p_assignment_id: assignmentId.data,
    p_student_ids: studentIds.data,
  });
  if (error) return { status: "error", message: describeRpcError(error) };
  revalidateAssignment(assignmentId.data);
  return { status: "ok", message: `${Number(data)} feladat kiosztva.` };
}
