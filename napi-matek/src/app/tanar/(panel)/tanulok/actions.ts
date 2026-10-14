"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/** Az eredmény, amit a felület megjelenít: hiba, vagy egy egyszer látható kód. */
export type CodeResult =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "code"; studentName: string; code: string; isNew: boolean };

const nameSchema = z
  .string()
  .trim()
  .min(1, "Adj meg egy nevet vagy becenevet.")
  .max(40, "Legfeljebb 40 karakter lehet.");

const idSchema = z.string().uuid();

/** Postgres hibakód → érthető üzenet. */
function describeDbError(code: string | undefined): string {
  switch (code) {
    case "23505":
      return "Már van ilyen nevű tanuló (kis- és nagybetű, ékezet nem számít). Adj meg eltérő nevet, pl. a vezetéknév kezdőbetűjével.";
    case "42501":
      return "Ehhez a művelethez tanári jogosultság kell.";
    case "P0002":
      return "A tanuló nem található.";
    default:
      return "A művelet nem sikerült. Próbáld újra.";
  }
}

/**
 * Új tanuló létrehozása.
 *
 * 1. Szintetikus Auth felhasználó (admin API): nem kézbesíthető e-mail-cím
 *    (.invalid TLD, RFC 2606), jelszó nélkül. Az e-mail-cím véletlen UUID,
 *    így a tanuló nevéből semmi sem kerül az Auth rendszerbe.
 * 2. A tanuló profilja és kódja a tanár saját munkamenetével, RPC-n át –
 *    az adatbázis is ellenőrzi, hogy tanár hívja.
 * Ha a 2. lépés elbukik (pl. foglalt név), az 1. lépést visszacsináljuk.
 */
export async function createStudentAction(
  _prev: CodeResult,
  formData: FormData,
): Promise<CodeResult> {
  const { supabase } = await requireTeacher();

  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Érvénytelen név." };
  }

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: `s-${randomUUID()}@students.invalid`,
    email_confirm: true,
    app_metadata: { role: "student" },
  });
  if (authError || !created.user) {
    return { status: "error", message: "A tanulói fiók létrehozása nem sikerült." };
  }

  const { data: code, error } = await supabase.rpc("create_student", {
    p_user_id: created.user.id,
    p_display_name: parsed.data,
  });
  if (error || typeof code !== "string") {
    await admin.auth.admin.deleteUser(created.user.id);
    return { status: "error", message: describeDbError(error?.code) };
  }

  revalidatePath("/tanar/tanulok");
  return { status: "code", studentName: parsed.data, code, isNew: true };
}

/** Új kód generálása; a tanuló minden eszközről azonnal kilép. */
export async function regenerateCodeAction(
  _prev: CodeResult,
  formData: FormData,
): Promise<CodeResult> {
  const { supabase } = await requireTeacher();

  const id = idSchema.safeParse(formData.get("studentId"));
  if (!id.success) return { status: "error", message: describeDbError("P0002") };

  const { data: code, error } = await supabase.rpc("regenerate_student_code", {
    p_student_id: id.data,
  });
  if (error || typeof code !== "string") {
    return { status: "error", message: describeDbError(error?.code) };
  }

  revalidatePath("/tanar/tanulok");
  return {
    status: "code",
    studentName: String(formData.get("studentName") ?? ""),
    code,
    isNew: false,
  };
}

/** Letiltás / visszaengedélyezés. Letiltáskor minden munkamenet megszűnik. */
export async function setDisabledAction(formData: FormData): Promise<void> {
  const { supabase } = await requireTeacher();

  const id = idSchema.safeParse(formData.get("studentId"));
  if (!id.success) return;

  await supabase.rpc("set_student_disabled", {
    p_student_id: id.data,
    p_disabled: formData.get("disabled") === "true",
  });
  revalidatePath("/tanar/tanulok");
}

/** Szülői hozzájárulás az AI-asszisztenshez (be/ki). */
export async function setAiConsentAction(formData: FormData): Promise<void> {
  const { supabase } = await requireTeacher();
  const id = idSchema.safeParse(formData.get("studentId"));
  if (!id.success) return;
  await supabase
    .from("students")
    .update({ ai_consent: formData.get("consent") === "true" })
    .eq("id", id.data);
  revalidatePath("/tanar/tanulok");
}

export type DeleteResult = { status: "idle" } | { status: "error"; message: string };

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A tanuló összes feltöltött fájljának törlése a `submissions` bucketből.
 * Mappaszerkezet: {student_id}/{student_task_id}/{fájl}. A Storage nem töröl
 * mappát rekurzívan, ezért előbb kilistázzuk a fájlokat.
 */
async function removeStudentFiles(admin: AdminClient, studentId: string): Promise<boolean> {
  const bucket = admin.storage.from("submissions");
  const { data: folders, error } = await bucket.list(studentId, { limit: 1000 });
  if (error) return false;

  const paths: string[] = [];
  for (const entry of folders ?? []) {
    // Mappa: nincs id-ja. Fájl a tanuló gyökerében elvileg nincs, de azt is kezeljük.
    if (entry.id) {
      paths.push(`${studentId}/${entry.name}`);
      continue;
    }
    const { data: files, error: listError } = await bucket.list(`${studentId}/${entry.name}`, {
      limit: 1000,
    });
    if (listError) return false;
    for (const file of files ?? []) paths.push(`${studentId}/${entry.name}/${file.name}`);
  }

  if (paths.length === 0) return true;
  const { error: removeError } = await bucket.remove(paths);
  return !removeError;
}

/**
 * Letiltott tanuló végleges törlése (GDPR: törléshez való jog).
 * Sorrend: fájlok → adatbázis (kaszkád) → Auth felhasználó. Ha egy lépés
 * elbukik, megállunk; a művelet újra futtatható, mert minden lépés idempotens.
 */
export async function deleteStudentAction(
  _prev: DeleteResult,
  formData: FormData,
): Promise<DeleteResult> {
  const { supabase } = await requireTeacher();

  const id = idSchema.safeParse(formData.get("studentId"));
  if (!id.success) return { status: "error", message: describeDbError("P0002") };

  const { data: student } = await supabase
    .from("students")
    .select("disabled_at")
    .eq("id", id.data)
    .maybeSingle<{ disabled_at: string | null }>();
  if (!student) return { status: "error", message: describeDbError("P0002") };
  if (!student.disabled_at) {
    return { status: "error", message: "Törlés előtt tiltsd le a tanulót." };
  }

  const admin = createAdminClient();
  if (!(await removeStudentFiles(admin, id.data))) {
    return { status: "error", message: "A tanuló fájljainak törlése nem sikerült. Próbáld újra." };
  }

  const { error } = await supabase.rpc("delete_student", { p_student_id: id.data });
  if (error) return { status: "error", message: describeDbError(error.code) };

  // Az adatbázisban már nincs nyoma; az Auth felhasználó törlése zárja a folyamatot.
  await admin.auth.admin.deleteUser(id.data);

  revalidatePath("/tanar/tanulok");
  return { status: "idle" };
}
