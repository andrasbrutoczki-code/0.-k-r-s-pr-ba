/**
 * Feladattípusok és a becsült megoldási idő. Függőség nélküli, tesztelhető.
 *
 * A típus határozza meg a beadás módját (3. lépés):
 *   teszt     – feleletválasztós; kép nem kell, rövid szöveges indoklás igen
 *   rovid     – rövid válasz (egy eredmény), szövegmezőben
 *   kifejtos  – levezetés, fényképpel
 */

export type TaskType = "teszt" | "rovid" | "kifejtos";

export const TASK_TYPES: TaskType[] = ["teszt", "rovid", "kifejtos"];

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  teszt: "Teszt",
  rovid: "Rövid válasz",
  kifejtos: "Kifejtős",
};

/** Alapértelmezés a „kép kell” jelölőhöz: csak a kifejtős feladat kér fényképet. */
export function defaultRequiresImage(type: TaskType): boolean {
  return type === "kifejtos";
}

/** (A) és (B) válaszlehetőség a szövegben → feleletválasztós. */
export function looksMultipleChoice(body: string): boolean {
  return /\(A\)/.test(body) && /\(B\)/.test(body);
}

/** Típus kikövetkeztetése, ha nincs megadva (importnál) – ugyanaz, mint a migráció besorolása. */
export function inferTaskType(body: string, requiresImage: boolean | null): TaskType {
  if (looksMultipleChoice(body)) return "teszt";
  if (requiresImage === false) return "rovid";
  return "kifejtos";
}

/**
 * Becsült megoldási idő percben, ha a feladatnál nincs megadva.
 * Teszt 2–6, rövid válasz 4–12, kifejtős 10–30 perc a nehézségtől függően.
 */
export function estimateMinutes(type: TaskType, difficulty: number, explicit?: number | null): number {
  if (explicit && explicit > 0) return explicit;
  const d = Math.min(5, Math.max(1, difficulty));
  if (type === "teszt") return 1 + d;
  if (type === "rovid") return 2 + 2 * d;
  return 5 + 5 * d;
}

/** Típus felismerése szövegből (import): „feleletválasztós”, „rövid válasz”, „kifejtős” stb. */
export function parseTaskType(input: string): TaskType | null {
  const key = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!key) return null;
  if (["teszt", "test", "feleletvalasztos", "valasztos", "mc"].includes(key)) return "teszt";
  if (["rovid", "rovidvalasz", "rovidvalaszos", "short"].includes(key)) return "rovid";
  if (["kifejtos", "kifejto", "hosszu", "long"].includes(key)) return "kifejtos";
  return null;
}

/**
 * A tesztfeladat válaszlehetőségeinek betűjelei a szövegből: „(A)”, „(B)”…
 * Ha a szöveg nem tartalmaz ilyet, az A–D alapértelmezést adjuk.
 */
export function choiceLetters(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\(([A-F])\)/g)) found.add(match[1]!);
  const letters = [...found].sort();
  return letters.length >= 2 ? letters : ["A", "B", "C", "D"];
}

/**
 * Helyes válasz betűjele tetszőleges beírt formából: „B”, „b”, „(B)”, „B)”.
 * Érvénytelen bemenetre null.
 */
export function parseChoice(input: string): string | null {
  const match = /^\(?\s*([A-Fa-f])\s*\)?\.?$/.exec(input.trim());
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * A helyes válasz kiolvasása a megoldási útmutatóból, ha az
 * „Helyes válasz: (B) …” formájú (a meglévő feladatbank így készült).
 */
export function extractCorrectChoice(solution: string): string | null {
  const match = /helyes\s+v[áa]lasz\s*:?\s*\(?([A-F])\)/i.exec(solution);
  return match ? match[1]!.toUpperCase() : null;
}
