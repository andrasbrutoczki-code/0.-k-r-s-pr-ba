import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type Role = "teacher" | "student";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface SessionUser {
  supabase: SupabaseServerClient;
  user: User;
  role: Role | null;
}

export interface StudentSession extends SessionUser {
  role: "student";
  displayName: string;
  expiresAt: Date;
}

/**
 * A kérés bejelentkezett felhasználója és szerepköre.
 * A React cache() miatt kérésenként egyszer fut, akárhány komponens hívja.
 * getUser() (nem getSession()): az Auth szerverrel ellenőrzi a tokent.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: role } = await supabase.rpc("my_role");
  return { supabase, user, role: (role as Role | null) ?? null };
});

/** Tanári oldalak és actionök őre. Nem tanár → tanári belépés. */
export async function requireTeacher(): Promise<SessionUser & { role: "teacher" }> {
  const session = await getSessionUser();
  if (!session || session.role !== "teacher") redirect("/tanar/belepes");
  return session as SessionUser & { role: "teacher" };
}

interface StudentSessionStateRow {
  valid: boolean;
  expires_at: string;
  display_name: string;
}

/**
 * Tanulói oldalak és actionök őre.
 * A munkamenet érvényességét az adatbázis dönti el (lejárat, visszavonás,
 * kódverzió, letiltás). Érvénytelen munkamenetnél a /kilepes útvonal törli
 * a sütiket – Server Componentből ezt közvetlenül nem tehetnénk meg.
 */
export const requireStudent = cache(async (): Promise<StudentSession> => {
  const session = await getSessionUser();
  if (!session || session.role !== "student") redirect("/belepes");

  const { data } = await session.supabase
    .rpc("student_session_state")
    .maybeSingle<StudentSessionStateRow>();
  if (!data?.valid) redirect("/kilepes?ok=lejart");

  return {
    ...session,
    role: "student",
    displayName: data.display_name,
    expiresAt: new Date(data.expires_at),
  };
});
