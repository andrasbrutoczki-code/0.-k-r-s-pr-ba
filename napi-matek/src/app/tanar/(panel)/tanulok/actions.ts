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
