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

/** Egy kódformájú részlet: 4 + 4 karakter az ábécéből, köztük opcionális kötőjel/szóköz. */
const CODE_IN_TEXT = /[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}[-\s]?[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}/g;

/**
 * Kód kinyerése beillesztett szövegből.
 * Ha a tanuló egy egész üzenetet illeszt be (pl. „Teszt Elek\nBelépőkód: ABCD-EFGH”),
 * a normalizált szöveg hosszabb 8 karakternél; ilyenkor a szöveg UTOLSÓ kódformájú
 * részletét vesszük (a név jellemzően előtte áll). Gépelésnél ez nem fut.
 */
export function extractCode(input: string): string {
  const normalized = normalizeCode(input);
  if (normalized.length <= CODE_LENGTH) return normalized;
  const matches = input.toUpperCase().match(CODE_IN_TEXT);
  const last = matches?.at(-1);
  return last ? normalizeCode(last) : normalized.slice(0, CODE_LENGTH);
}

/** Megjelenítés és gépelés közbeni formázás: „ABCDEFGH” → „ABCD-EFGH”. */
export function formatCode(input: string): string {
  const code = extractCode(input).slice(0, CODE_LENGTH);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
