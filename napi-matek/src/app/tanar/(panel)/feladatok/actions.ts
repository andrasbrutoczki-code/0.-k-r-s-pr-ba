"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";

export type SaveTaskState =
  | { status: "idle" }
  | { status: "saved" }
  | { status: "error"; message: string; field?: string };

const MAX_FIGURE_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const taskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Adj címet a feladatnak.").max(200, "A cím legfeljebb 200 karakter."),
  topic_id: z.coerce.number().int().positive("Válassz témakört."),
  difficulty: z.coerce.number().int().min(1).max(5, "A nehézség 1 és 5 közötti."),
  requires_image: z.boolean(),
  body_md: z.string().trim().min(1, "Írd be a feladat szövegét.").max(20000),
  solution_md: z.string().trim().max(20000),
});

/** Valódi PNG-e (a fájlnév és a MIME-típus hamisítható, a fájl eleje nem). */
async function isPng(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return PNG_SIGNATURE.every((byte, i) => head[i] === byte);
}

/**
 * Feladat mentése (új vagy meglévő), a megoldási útmutatóval és az ábrával.
 * Minden írás a tanár saját kliensével, RLS alatt történik.
 */
export async function saveTaskAction(_prev: SaveTaskState, formData: FormData): Promise<SaveTaskState> {
  const { supabase } = await requireTeacher();

  const parsed = taskSchema.safeParse({
    id: formData.get("id") || undefined,
    title: formData.get("title"),
    topic_id: formData.get("topic_id"),
    difficulty: formData.get("difficulty"),
    requires_image: formData.get("requires_image") === "on",
    body_md: formData.get("body_md") ?? "",
    solution_md: formData.get("solution_md") ?? "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", message: issue?.message ?? "Hibás adat.", field: issue?.path[0]?.toString() };
  }
  const { id: existingId, solution_md, ...fields } = parsed.data;

  // Ábra ellenőrzése még a mentés előtt, hogy hibás fájlnál ne maradjon félkész feladat.
  const figure = formData.get("figure");
  const newFigure = figure instanceof File && figure.size > 0 ? figure : null;
  if (newFigure) {
    if (newFigure.size > MAX_FIGURE_BYTES) {
      return { status: "error", message: "Az ábra legfeljebb 5 MB lehet.", field: "figure" };
    }
    if (!(await isPng(newFigure))) {
      return { status: "error", message: "Az ábra csak PNG fájl lehet.", field: "figure" };
    }
  }

  let id = existingId;
  let oldFigurePath: string | null = null;

  if (id) {
    const { data: current } = await supabase
      .from("tasks")
      .select("figure_path")
      .eq("id", id)
      .maybeSingle<{ figure_path: string | null }>();
    if (!current) return { status: "error", message: "A feladat nem található." };
    oldFigurePath = current.figure_path;

    const { error } = await supabase
      .from("tasks")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { status: "error", message: "A mentés nem sikerült." };
  } else {
    const { data, error } = await supabase.from("tasks").insert(fields).select("id").single<{ id: string }>();
    if (error || !data) return { status: "error", message: "A mentés nem sikerült." };
    id = data.id;
  }

  // Megoldási útmutató: külön, csak tanár által olvasható táblában.
  const solutionResult = solution_md
    ? await supabase.from("task_solutions").upsert({ task_id: id, solution_md }, { onConflict: "task_id" })
    : await supabase.from("task_solutions").delete().eq("task_id", id);
  if (solutionResult.error) return { status: "error", message: "Az útmutató mentése nem sikerült." };

  // Ábra: új feltöltése vagy a meglévő eltávolítása.
  const bucket = supabase.storage.from("task-figures");
  if (newFigure) {
    const path = `${id}/${randomUUID()}.png`;
    const { error: uploadError } = await bucket.upload(path, newFigure, { contentType: "image/png" });
    if (uploadError) return { status: "error", message: "Az ábra feltöltése nem sikerült.", field: "figure" };
    await supabase.from("tasks").update({ figure_path: path }).eq("id", id);
    if (oldFigurePath) await bucket.remove([oldFigurePath]);
  } else if (formData.get("remove_figure") === "on" && oldFigurePath) {
    await supabase.from("tasks").update({ figure_path: null }).eq("id", id);
    await bucket.remove([oldFigurePath]);
  }

  revalidatePath("/tanar/feladatok");
  if (!existingId) redirect(`/tanar/feladatok/${id}?mentve=1`);
  revalidatePath(`/tanar/feladatok/${id}`);
  return { status: "saved" };
}

/**
 * Archiválás / visszaállítás. Feladatot nem törlünk: lehet, hogy már ki van
 * osztva, és a tanulók beadásai hivatkoznak rá. Az archivált feladat nem
 * kerülhet új munkalapra és kiosztásba.
 */
export async function setTaskArchivedAction(formData: FormData): Promise<void> {
  const { supabase } = await requireTeacher();
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  await supabase
    .from("tasks")
    .update({ archived_at: formData.get("archived") === "true" ? new Date().toISOString() : null })
    .eq("id", id.data);
  revalidatePath("/tanar/feladatok");
  revalidatePath(`/tanar/feladatok/${id.data}`);
}
