"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudent } from "@/lib/auth/guards";

const uuid = z.string().uuid();

const ERRORS: Record<string, string> = {
  choice_required: "Jelöld meg a választ (betűjel).",
  reasoning_required: "Írj rövid indoklást a válaszodhoz.",
  answer_required: "Írd be a válaszodat.",
  answer_too_long: "A válasz túl hosszú (legfeljebb 5000 karakter).",
  image_required: "Tölts fel legalább egy fényképet a megoldásodról.",
  not_submittable: "Ezt a feladatot már beadtad. Ha a tanárod javítást kér, újra beadhatod.",
  not_yet_available: "Ez a feladat még nem elérhető.",
  task_not_found: "A feladat nem található.",
};

function describe(error: { message?: string } | null): string {
  const key = Object.keys(ERRORS).find((k) => error?.message?.startsWith(k));
  return key ? ERRORS[key]! : "Valami nem sikerült. Próbáld újra.";
}

export type DraftResult = { ok: true; draftId: string } | { ok: false; message: string };
export type SubmitResult = { ok: true; encouragement: string } | { ok: false; message: string };
export type MessageResult = { ok: true } | { ok: false; message: string };

/** A beadás vázlata (a képfeltöltés ehhez kötődik). Ha nincs, létrehozza. */
export async function ensureDraftAction(studentTaskId: string): Promise<DraftResult> {
  const { supabase } = await requireStudent();
  if (!uuid.safeParse(studentTaskId).success) return { ok: false, message: describe(null) };
  const { data, error } = await supabase.rpc("get_or_create_draft", { p_student_task_id: studentTaskId });
  if (error || typeof data !== "string") return { ok: false, message: describe(error) };
  return { ok: true, draftId: data };
}

/** Beadás (a „Kész” pipa). Visszaadja a biztató üzenetet. */
export async function submitTaskAction(
  studentTaskId: string,
  choice: string | null,
  answerText: string | null,
): Promise<SubmitResult> {
  const { supabase } = await requireStudent();
  if (!uuid.safeParse(studentTaskId).success) return { ok: false, message: describe(null) };
  const { data, error } = await supabase.rpc("submit_task", {
    p_student_task_id: studentTaskId,
    p_choice: choice,
    p_answer_text: answerText?.slice(0, 5000) ?? null,
  });
  if (error || typeof data !== "string") return { ok: false, message: describe(error) };
  revalidatePath("/tanulo");
  revalidatePath(`/tanulo/feladat/${studentTaskId}`);
  return { ok: true, encouragement: data };
}

/** Üzenet a tanárnak a feladat szálában. */
export async function sendMessageAction(studentTaskId: string, body: string): Promise<MessageResult> {
  const { supabase, user } = await requireStudent();
  const text = body.trim();
  if (!uuid.safeParse(studentTaskId).success) return { ok: false, message: describe(null) };
  if (!text) return { ok: false, message: "Írj üzenetet." };
  if (text.length > 5000) return { ok: false, message: "Az üzenet legfeljebb 5000 karakter lehet." };
  const { error } = await supabase
    .from("messages")
    .insert({ student_task_id: studentTaskId, author_id: user.id, body_md: text });
  if (error) return { ok: false, message: "Az üzenet nem ment el. Próbáld újra." };
  revalidatePath(`/tanulo/feladat/${studentTaskId}`);
  revalidatePath("/tanulo");
  return { ok: true };
}
