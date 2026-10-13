import "server-only";
import { headers } from "next/headers";

/**
 * A kliens IP-címe a rate limithez.
 *
 * Sorrend: a hoszting által beállított, nem hamisítható fejléc (Netlify:
 * x-nf-client-connection-ip), aztán a szokásos proxyfejlécek. Az
 * x-forwarded-for első eleme a kliens által is beállítható lehet, ezért
 * a névalapú korlát a második védelmi vonal (lásd check_login_rate).
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const candidates = [
    h.get("x-nf-client-connection-ip"),
    h.get("x-real-ip"),
    h.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const value of candidates) {
    const ip = value?.trim();
    if (ip) return ip.slice(0, 64);
  }
  return "unknown";
}
