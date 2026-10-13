import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/auth/client-ip";
import { sessionIdFromAccessToken } from "@/lib/auth/jwt";
import { isWellFormedCode, normalizeCode } from "@/lib/auth/code";

export type StudentLoginResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "invalid" | "server_error" };

interface VerifiedStudent {
  student_id: string;
  code_version: number;
}

/**
 * Tanulói belépés név + kód alapján. Belépéskor és a lejárat előtti
 * megújításkor is ez fut.
 *
 * Lépések:
 *   1. rate limit (IP és név szerint) – minden próbálkozás számít,
 *   2. kódellenőrzés az adatbázisban (bcrypt, időzítés-kiegyenlítéssel),
 *   3. Supabase munkamenet létrehozása jelszó nélkül: az admin API egyszer
 *      használható magic link tokent ad (e-mailt NEM küld), amit rögtön
 *      beváltunk – a sütiket a @supabase/ssr írja,
 *   4. az új munkamenet nyilvántartása 365 napos lejárattal,
 *   5. megújításnál a régi munkamenet visszavonása.
 */
export async function loginStudent(name: string, rawCode: string): Promise<StudentLoginResult> {
  const admin = createAdminClient();
  const ip = await getClientIp();

  const { data: allowed, error: rateError } = await admin.rpc("check_login_rate", {
    p_ip: ip,
    p_name: name,
  });
  if (rateError) return { ok: false, reason: "server_error" };
  if (!allowed) return { ok: false, reason: "rate_limited" };

  // Formailag hibás kódnál nem terheljük a bcryptet (a próbálkozás már számít).
  if (!isWellFormedCode(rawCode)) return { ok: false, reason: "invalid" };

  const { data: verified, error: verifyError } = await admin
    .rpc("verify_student_code", { p_name: name, p_code: normalizeCode(rawCode) })
    .maybeSingle<VerifiedStudent>();
  if (verifyError) return { ok: false, reason: "server_error" };
  if (!verified) return { ok: false, reason: "invalid" };

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(
    verified.student_id,
  );
  const email = userData?.user?.email;
  if (userError || !email) return { ok: false, reason: "server_error" };

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link?.properties?.hashed_token) return { ok: false, reason: "server_error" };

  const supabase = await createClient();

  // Megújításnál a jelenlegi (régi) munkamenet azonosítója; a beváltás után visszavonjuk.
  const {
    data: { session: previous },
  } = await supabase.auth.getSession();
  const previousSessionId = previous ? sessionIdFromAccessToken(previous.access_token) : null;

  const { data: otp, error: otpError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  const sessionId = otp?.session ? sessionIdFromAccessToken(otp.session.access_token) : null;
  if (otpError || !sessionId) return { ok: false, reason: "server_error" };

  const userAgent = (await headers()).get("user-agent") ?? "";
  const { error: registerError } = await admin.rpc("register_student_session", {
    p_session_id: sessionId,
    p_student_id: verified.student_id,
    p_code_version: verified.code_version,
    p_user_agent: userAgent,
  });
  if (registerError) {
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, reason: "server_error" };
  }

  if (previousSessionId && previousSessionId !== sessionId) {
    // Az adatbázis csak akkor von vissza, ha a munkamenet ugyanehhez a tanulóhoz tartozik.
    await admin.rpc("revoke_student_session", {
      p_session_id: previousSessionId,
      p_student_id: verified.student_id,
    });
  }

  return { ok: true };
}

/** Kilépés: a saját nyilvántartásunkban és az Auth-ban is lezárja a munkamenetet. */
export async function logoutCurrentUser(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const sessionId = sessionIdFromAccessToken(session.access_token);
    if (sessionId) {
      await createAdminClient().rpc("revoke_student_session", {
        p_session_id: sessionId,
        p_student_id: session.user.id,
      });
    }
  }
  await supabase.auth.signOut({ scope: "local" });
}
