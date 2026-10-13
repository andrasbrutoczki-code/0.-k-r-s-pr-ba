/**
 * Feladatszöveg felbontása szöveg- és képletrészekre.
 *
 * Formátum (a LaTeX-ben megszokott jelölés):
 *   $…$    soron belüli képlet
 *   $$…$$  kiemelt (külön sorban álló) képlet
 *   \$     szó szerinti dollárjel (pl. „5 \$”)
 * Lezáratlan képletnél a nyitó $ szövegként marad, így egy elgépelés nem
 * „nyeli el” a feladat többi részét.
 *
 * Függőség nélküli tiszta függvény: szerveren és böngészőben is fut, és
 * önállóan tesztelhető.
 */

export type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

export function splitMath(source: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let text = "";
  let i = 0;

  const flushText = () => {
    if (text) segments.push({ kind: "text", value: text });
    text = "";
  };

  while (i < source.length) {
    const ch = source[i];

    // \$ → szó szerinti dollárjel
    if (ch === "\\" && source[i + 1] === "$") {
      text += "$";
      i += 2;
      continue;
    }

    if (ch === "$") {
      const display = source[i + 1] === "$";
      const open = display ? 2 : 1;
      const close = findClosing(source, i + open, display);
      if (close === -1) {
        // Lezáratlan: szövegként megtartjuk a nyitó jelet.
        text += source.slice(i, i + open);
        i += open;
        continue;
      }
      const value = source.slice(i + open, close).trim();
      if (value) {
        flushText();
        segments.push({ kind: "math", value, display });
      }
      i = close + open;
      continue;
    }

    text += ch;
    i += 1;
  }

  flushText();
  return segments;
}

/** A záró $ vagy $$ indexe; a \$ nem zár. -1, ha nincs. */
function findClosing(source: string, from: number, display: boolean): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] === "\\") {
      j += 1; // a következő karakter escape-elt (pl. \$ vagy \\)
      continue;
    }
    if (source[j] !== "$") continue;
    if (display) {
      if (source[j + 1] === "$") return j;
    } else {
      return j;
    }
  }
  return -1;
}
