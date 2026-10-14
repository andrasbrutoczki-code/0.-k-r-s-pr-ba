"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";

const uuid = z.string().uuid();

export type ReviewResult = { ok: true } | { ok: false; message: string };

const ERRORS: Record<string, string> = {
  message_empty: "Írj üzenetet.",
  invalid_decision: "Érvénytelen döntés.",
  nothing_submitted: "Ezt a feladatot még nem adta be a tanuló.",
  not_reopenable: "Csak elfogadott feladat nyitható vissza.",
  task_not_found: "A feladat nem található.",
};

function describe(error: { message?: string } | null): string {
  const key = Object.keys(ERRORS).find((k) => error?.message?.startsWith(k));
  return key ? ERRORS[key]! : "A művelet nem sikerült. Próbáld újra.";
}

function revalidate(id: string) {
  revalidatePath(`/tanar/ellenorzes/${id}`);
  revalidatePath("/tanar/ellenorzes");
  // A menü jelvénye a tanári layoutban van.
  revalidatePath("/tanar", "layout");
}

/** Megnyitáskor: Beadva → Javítás alatt, és a tanuló üzenetei olvasottak lesznek. */
export async function openForReviewAction(id: string): Promise<{ changed: boolean }> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(id).success) return { changed: false };
  const before = await supabase.from("student_tasks").select("status").eq("id", id).maybeSingle<{ status: string }>();
  const [{ data: status }] = await Promise.all([
    supabase.rpc("open_for_review", { p_student_task_id: id }),
    supabase.rpc("mark_thread_read", { p_student_task_id: id }),
  ]);
  const changed = before.data?.status !== status;
  revalidate(id);
  return { changed };
}

export async function teacherMessageAction(id: string, body: string): Promise<ReviewResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(id).success) return { ok: false, message: describe(null) };
  const { error } = await supabase.rpc("teacher_message", { p_student_task_id: id, p_body: body.slice(0, 5000) });
  if (error) return { ok: false, message: describe(error) };
  revalidate(id);
  return { ok: true };
}

export async function decisionAction(
  id: string,
  decision: "accepted" | "needs_revision",
  message: string,
): Promise<ReviewResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(id).success) return { ok: false, message: describe(null) };
  const { error } = await supabase.rpc("set_review_decision", {
    p_student_task_id: id,
    p_status: decision,
    p_message: message.slice(0, 5000) || null,
  });
  if (error) return { ok: false, message: describe(error) };
  revalidate(id);
  return { ok: true };
}

export async function reopenAction(id: string): Promise<ReviewResult> {
  const { supabase } = await requireTeacher();
  if (!uuid.safeParse(id).success) return { ok: false, message: describe(null) };
  const { error } = await supabase.rpc("reopen_review", { p_student_task_id: id });
  if (error) return { ok: false, message: describe(error) };
  revalidate(id);
  return { ok: true };
}
