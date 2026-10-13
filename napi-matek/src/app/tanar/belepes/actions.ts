"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/auth/client-ip";

export interface TeacherLoginState {
  error?: string;
  email?: string;
}

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Adj meg egy érvényes e-mail-címet."),
  password: z.string().min(1, "Add meg a jelszavad."),
});

/**
 * Tanári belépés e-mail + jelszóval (Supabase Auth). A tanulói belépéssel
 * azonos rate limit véd: IP-nként és (itt) e-mail-címenként.
 * Sikeres jelszó után is ellenőrizzük a szerepkört: aki nem tanár, azt
 * azonnal kiléptetjük.
 */
export async function teacherLoginAction(
  _prev: TeacherLoginState,
  formData: FormData,
): Promise<TeacherLoginState> {
  const email = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, email };
  }

  const { data: allowed } = await createAdminClient().rpc("check_login_rate", {
    p_ip: await getClientIp(),
    p_name: `tanar:${parsed.data.email}`,
  });
  if (!allowed) {
    return { error: "Túl sok próbálkozás. Várj 15 percet, és próbáld újra.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Hibás e-mail-cím vagy jelszó.", email };

  const { data: role } = await supabase.rpc("my_role");
  if (role !== "teacher") {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Ez a fiók nem tanári fiók.", email };
  }

  redirect("/tanar");
}
