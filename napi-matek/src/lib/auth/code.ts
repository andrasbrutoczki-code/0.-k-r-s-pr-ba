/**
 * Belépőkód formázása és normalizálása a felületen.
 *
 * A kódot az adatbázis generálja (generate_login_code) és normalizálja
 * (normalize_login_code); itt csak a felhasználói élményt segítjük:
 * gépelés közben „ABCD-EFGH” alakra formázunk, beküldéskor tisztítunk.
 * Az ábécé szándékosan nem tartalmazza a 0, O, 1, I karaktereket, és csak
 * nagybetűs, így l sincs benne.
 */

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

/** Nagybetű, csak alfanumerikus karakterek – ugyanaz, mint az SQL oldalon. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Igaz, ha a normalizált kód formailag érvényes (hossz + ábécé). */
export function isWellFormedCode(input: string): boolean {
  const code = normalizeCode(input);
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** Megjelenítés és gépelés közbeni formázás: „ABCDEFGH” → „ABCD-EFGH”. */
export function formatCode(input: string): string {
  const code = normalizeCode(input).slice(0, CODE_LENGTH);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
