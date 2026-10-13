/**
 * JWT payload olvasása ELLENŐRZÉS NÉLKÜL.
 *
 * Csak olyan tokenre használjuk, amelyet épp most kaptunk közvetlenül a
 * Supabase Auth-tól (verifyOtp válasza), vagy amelynek egy mezőjét
 * kizárólag „saját munkamenet visszavonására” használjuk, ahol az adatbázis
 * a student_id egyezését is megköveteli. Jogosultsági döntést erre nem
 * alapozunk: azt a PostgREST által ellenőrzött auth.jwt() végzi.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const payload: unknown = JSON.parse(json);
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A Supabase access token `session_id` claimje (UUID), ha van. */
export function sessionIdFromAccessToken(token: string): string | null {
  const value = decodeJwtPayload(token)?.session_id;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
