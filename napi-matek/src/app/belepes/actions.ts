"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loginStudent } from "@/lib/auth/student-login";

export interface LoginFormState {
  error?: string;
  name?: string;
}

const schema = z.object({
  name: z.string().trim().min(1, "Írd be a neved.").max(40),
  code: z.string().trim().min(1, "Írd be a belépőkódod.").max(20),
});

const messages = {
  invalid: "A név vagy a belépőkód nem egyezik. Ellenőrizd, és próbáld újra.",
  rate_limited: "Túl sok próbálkozás. Várj 15 percet, vagy kérj segítséget a tanárodtól.",
  server_error: "A belépés most nem sikerült. Próbáld újra pár perc múlva.",
} as const;

/** Tanulói belépés (és a lejárat előtti megújítás) űrlapja. */
export async function studentLoginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
  });
  const name = String(formData.get("name") ?? "");
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? messages.invalid, name };
  }

  const result = await loginStudent(parsed.data.name, parsed.data.code);
  if (!result.ok) return { error: messages[result.reason], name };

  redirect("/tanulo");
}
