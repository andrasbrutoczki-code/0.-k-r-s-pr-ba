import {
  choiceLetters,
  defaultRequiresImage,
  extractCorrectChoice,
  inferTaskType,
  parseChoice,
  parseTaskType,
  type TaskType,
} from "../task-types.ts";

/**
 * Feladatok tömeges importja: JSON és CSV feldolgozása és soronkénti validálása.
 *
 * Függőség nélküli tiszta kód: a böngészőben az előnézethez, a szerveren a
 * beküldött sorok újraellenőrzéséhez fut ugyanaz a logika (a kliensnek nem
 * hiszünk, de ugyanazokat a szabályokat alkalmazzuk).
 *
 * Mezők (a kulcsok kis- és nagybetű-, ékezet- és elválasztó-függetlenek):
 *   cim, szoveg, temakor (egy vagy több, „|” vagy „;” jellel elválasztva,
 *   JSON-ban tömb is lehet; az első az elsődleges), nehezseg (1–5),
 *   tipus (teszt / rovid / kifejtos; ha hiányzik, a szövegből következtetjük),
 *   ido_perc (becsült megoldási idő, 1–120; ha hiányzik, becsüljük),
 *   kep_kell (alapból: csak kifejtősnél igen),
 *   abra (PNG fájlnév, csak ZIP-ben), megoldasi_utmutato,
 *   helyes (tesztnél a helyes válasz betűje; ha hiányzik, az útmutató
 *   „Helyes válasz: (B)” kezdetéből olvassuk ki)
 * A `pontszam` mezőt elfogadjuk, de figyelmen kívül hagyjuk (nincs pontozás).
 */

export const MAX_IMPORT_ROWS = 1000;

export interface TopicRef {
  slug: string;
  name: string;
}

/** Egy validált, beszúrható sor. */
export interface ImportRow {
  title: string;
  body_md: string;
  /** Egy vagy több témakör; az első az elsődleges. */
  topic_slugs: string[];
  difficulty: number;
  requires_image: boolean;
  task_type: TaskType;
  est_minutes?: number;
  /** A ZIP-ben lévő ábrafájl neve (feltöltés előtt); a szerver már storage-útvonalat kap. */
  figure?: string;
  solution_md?: string;
  /** Tesztnél a helyes válasz betűje (A–F). */
  correct_choice?: string;
}

export interface ParsedRow {
  /** Sorszám a fájlban (JSON: 1-től számozott elem, CSV: a fájl sora). */
  line: number;
  title: string;
  row?: ImportRow;
  errors: string[];
  warnings: string[];
}

export class ImportFormatError extends Error {}

// -----------------------------------------------------------------------------
// Normalizálás
// -----------------------------------------------------------------------------

/** Kisbetű, ékezet és minden nem alfanumerikus karakter nélkül. */
export function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIASES: Record<string, keyof RawFields> = {
  cim: "title",
  title: "title",
  szoveg: "body",
  feladat: "body",
  body: "body",
  temakor: "topic",
  tema: "topic",
  topic: "topic",
  nehezseg: "difficulty",
  difficulty: "difficulty",
  kepkell: "requiresImage",
  kepetker: "requiresImage",
  requiresimage: "requiresImage",
  abra: "figure",
  figure: "figure",
  megoldasiutmutato: "solution",
  megoldas: "solution",
  utmutato: "solution",
  solution: "solution",
  pontszam: "points",
  pont: "points",
  tipus: "type",
  feladattipus: "type",
  type: "type",
  idoperc: "minutes",
  ido: "minutes",
  perc: "minutes",
  becsultido: "minutes",
  minutes: "minutes",
  helyes: "correct",
  helyesvalasz: "correct",
  megoldasbetu: "correct",
  correct: "correct",
  correctchoice: "correct",
};

interface RawFields {
  title?: unknown;
  body?: unknown;
  topic?: unknown;
  difficulty?: unknown;
  requiresImage?: unknown;
  figure?: unknown;
  solution?: unknown;
  points?: unknown;
  type?: unknown;
  minutes?: unknown;
  correct?: unknown;
}

function mapFields(record: Record<string, unknown>): { fields: RawFields; unknown: string[] } {
  const fields: RawFields = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const target = FIELD_ALIASES[normalizeKey(key)];
    if (target) fields[target] = value;
    else unknown.push(key);
  }
  return { fields, unknown };
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// -----------------------------------------------------------------------------
// Mezőszintű értelmezés
// -----------------------------------------------------------------------------

/** Témakör keresése slug, teljes név vagy egyértelmű névkezdet alapján. */
export function matchTopic(input: string, topics: TopicRef[]): TopicRef | null {
  const key = normalizeKey(input);
  if (!key) return null;
  const exact = topics.find((t) => normalizeKey(t.slug) === key || normalizeKey(t.name) === key);
  if (exact) return exact;
  const prefixed = topics.filter((t) => normalizeKey(t.name).startsWith(key));
  return prefixed.length === 1 ? prefixed[0]! : null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const key = normalizeKey(asText(value));
  if (key === "") return null;
  if (["igen", "i", "true", "1", "yes", "y"].includes(key)) return true;
  if (["nem", "n", "false", "0", "no"].includes(key)) return false;
  return null;
}

/** Páratlan számú, nem escape-elt $ → valószínűleg lezáratlan képlet. */
function hasUnbalancedDollar(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "$") count += 1;
  }
  return count % 2 === 1;
}

// -----------------------------------------------------------------------------
// Sor validálása
// -----------------------------------------------------------------------------

export interface ValidateOptions {
  topics: TopicRef[];
  /** ZIP-ben elérhető ábrafájlok neve; ha nincs megadva, ábra nem hivatkozható. */
  figures?: Set<string>;
  /** A feladatbank már meglévő címei (normalizált kulccsal), duplikátum-figyelmeztetéshez. */
  existingTitles?: Set<string>;
}

export function validateRecord(
  record: Record<string, unknown>,
  line: number,
  options: ValidateOptions,
): ParsedRow {
  const { fields, unknown } = mapFields(record);
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = asText(fields.title);
  if (!title) errors.push("Hiányzik a cím.");
  else if (title.length > 200) errors.push("A cím legfeljebb 200 karakter lehet.");

  const body = asText(fields.body);
  if (!body) errors.push("Hiányzik a feladat szövege.");
  else if (body.length > 20000) errors.push("A feladat szövege túl hosszú (max. 20 000 karakter).");
  else if (hasUnbalancedDollar(body)) warnings.push("A szövegben lezáratlan képlet ($) lehet.");

  // Több témakör: JSON-tömb, vagy „|” / „;” jellel elválasztva (a nevekben vessző is lehet).
  const topicInputs = (Array.isArray(fields.topic) ? fields.topic.map(asText) : asText(fields.topic).split(/[|;]/))
    .map((t) => t.trim())
    .filter(Boolean);
  const topicSlugs: string[] = [];
  if (topicInputs.length === 0) errors.push("Hiányzik a témakör.");
  for (const input of topicInputs) {
    const match = matchTopic(input, options.topics);
    if (!match) errors.push(`Ismeretlen témakör: „${input}”.`);
    else if (!topicSlugs.includes(match.slug)) topicSlugs.push(match.slug);
  }

  const difficultyText = asText(fields.difficulty);
  const difficulty = Number(difficultyText);
  if (!difficultyText) errors.push("Hiányzik a nehézség (1–5).");
  else if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    errors.push(`A nehézség 1 és 5 közötti egész szám legyen (most: „${difficultyText}”).`);
  }

  const typeInput = asText(fields.type);
  const explicitType = typeInput ? parseTaskType(typeInput) : null;
  if (typeInput && !explicitType) {
    errors.push(`Ismeretlen feladattípus: „${typeInput}” (teszt, rovid vagy kifejtos).`);
  }

  let requiresImage: boolean | null = null;
  if (fields.requiresImage !== undefined && asText(fields.requiresImage) !== "") {
    const parsed = parseBoolean(fields.requiresImage);
    if (parsed === null) {
      errors.push("A „kep_kell” mező értéke igen/nem (vagy true/false) legyen.");
    } else {
      requiresImage = parsed;
    }
  }

  const taskType = explicitType ?? inferTaskType(body, requiresImage);
  if (requiresImage === null) requiresImage = defaultRequiresImage(taskType);

  const minutesText = asText(fields.minutes);
  const minutes = Number(minutesText.replace(",", "."));
  if (minutesText && (!Number.isInteger(minutes) || minutes < 1 || minutes > 120)) {
    errors.push(`A becsült idő 1 és 120 közötti egész perc legyen (most: „${minutesText}”).`);
  }

  const figure = asText(fields.figure);
  if (figure) {
    if (!/\.png$/i.test(figure)) errors.push("Az ábra csak PNG fájl lehet.");
    else if (!options.figures) errors.push("Ábrát csak ZIP-csomagban (JSON/CSV + PNG) lehet importálni.");
    else if (!options.figures.has(figure)) errors.push(`Az ábrafájl nincs a ZIP-ben: „${figure}”.`);
  }

  const solution = asText(fields.solution);
  if (solution.length > 20000) errors.push("A megoldási útmutató túl hosszú (max. 20 000 karakter).");

  // Helyes válasz: csak tesztnél értelmes; ha nincs megadva, az útmutatóból próbáljuk.
  const correctText = asText(fields.correct);
  let correct: string | null = null;
  if (correctText) {
    correct = parseChoice(correctText);
    if (!correct) errors.push(`A helyes válasz egy betű legyen A és F között (most: „${correctText}”).`);
    else if (taskType !== "teszt") {
      warnings.push("A helyes válasz csak tesztfeladatnál számít, itt kihagyjuk.");
      correct = null;
    }
  } else if (taskType === "teszt") {
    correct = extractCorrectChoice(solution);
  }
  if (taskType === "teszt" && !correct && !correctText) {
    warnings.push("Nincs helyes válasz megadva: a tanuló választását nem tudjuk automatikusan ellenőrizni.");
  }
  if (correct && taskType === "teszt" && !choiceLetters(body).includes(correct)) {
    warnings.push(`A helyes válasz („${correct}”) nem szerepel a válaszlehetőségek között.`);
  }

  if (asText(fields.points)) warnings.push("A pontszámot nem használjuk, figyelmen kívül hagyjuk.");
  if (unknown.length) warnings.push(`Ismeretlen mező(k), kihagyva: ${unknown.join(", ")}.`);
  if (title && options.existingTitles?.has(normalizeKey(title))) {
    warnings.push("Már van ilyen című feladat a feladatbankban.");
  }

  const row: ImportRow | undefined =
    errors.length === 0 && topicSlugs.length > 0
      ? {
          title,
          body_md: body,
          topic_slugs: topicSlugs,
          difficulty,
          requires_image: requiresImage,
          task_type: taskType,
          ...(minutesText ? { est_minutes: minutes } : {}),
          ...(figure ? { figure } : {}),
          ...(solution ? { solution_md: solution } : {}),
          ...(correct ? { correct_choice: correct } : {}),
        }
      : undefined;

  return { line, title: title || "(cím nélkül)", row, errors, warnings };
}

/** Fájlon belüli címismétlés jelzése (figyelmeztetés, nem hiba). */
function markDuplicateTitles(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeKey(row.title);
    const first = seen.get(key);
    if (first !== undefined && key) row.warnings.push(`Ugyanez a cím szerepel a(z) ${first}. sorban is.`);
    else seen.set(key, row.line);
  }
  return rows;
}

function checkCount(count: number): void {
  if (count === 0) throw new ImportFormatError("A fájl nem tartalmaz feladatot.");
  if (count > MAX_IMPORT_ROWS) {
    throw new ImportFormatError(`Egyszerre legfeljebb ${MAX_IMPORT_ROWS} feladat importálható (a fájlban: ${count}).`);
  }
}

// -----------------------------------------------------------------------------
// JSON
// -----------------------------------------------------------------------------

/** Elfogadott formák: `[ {...}, ... ]` vagy `{ "feladatok": [ ... ] }`. */
export function parseJsonImport(text: string, options: ValidateOptions): ParsedRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new ImportFormatError(`A JSON fájl hibás: ${(err as Error).message}`);
  }

  let items: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const container = data as Record<string, unknown>;
    items = container.feladatok ?? container.tasks;
  }
  if (!Array.isArray(items)) {
    throw new ImportFormatError("A JSON-ban egy tömb kell, vagy egy „feladatok” nevű tömb.");
  }
  checkCount(items.length);

  return markDuplicateTitles(
    items.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? validateRecord(item as Record<string, unknown>, index + 1, options)
        : { line: index + 1, title: "(hibás elem)", errors: ["Az elem nem objektum."], warnings: [] },
    ),
  );
}

// -----------------------------------------------------------------------------
// CSV
// -----------------------------------------------------------------------------

/** Az első sor alapján: pontosvessző (magyar Excel), vessző vagy tabulátor. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch]! += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * RFC 4180 szerinti CSV-olvasó: idézőjeles mezők, "" mint idézőjel, sortörés
 * az idézőjeles mezőn belül, CRLF/LF, BOM. Minden sorhoz a kezdősorszámát is adja.
 */
export function parseCsv(text: string): { cells: string[]; line: number }[] {
  const source = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(source);
  const rows: { cells: string[]; line: number }[] = [];

  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (!(cells.length === 1 && cells[0] === "")) rows.push({ cells, line: rowStart });
    cells = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) endField();
    else if (ch === "\r") continue;
    else if (ch === "\n") {
      endRow();
      line += 1;
      rowStart = line;
    } else field += ch;
  }
  if (inQuotes) throw new ImportFormatError("A CSV fájlban lezáratlan idézőjel van.");
  if (field !== "" || cells.length > 0) endRow();
  return rows;
}

export function parseCsvImport(text: string, options: ValidateOptions): ParsedRow[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new ImportFormatError("A CSV fájl üres.");
  checkCount(rows.length);

  return markDuplicateTitles(
    rows.map(({ cells, line }) => {
      const record: Record<string, unknown> = {};
      header.cells.forEach((name, index) => {
        record[name] = cells[index] ?? "";
      });
      return validateRecord(record, line, options);
    }),
  );
}
