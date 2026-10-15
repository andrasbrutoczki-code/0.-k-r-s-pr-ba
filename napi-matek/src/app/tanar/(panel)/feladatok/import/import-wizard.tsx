"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { strFromU8, unzipSync } from "fflate";
import { createClient } from "@/lib/supabase/client";
import {
  ImportFormatError,
  normalizeKey,
  parseCsvImport,
  parseJsonImport,
  type ImportRow,
  type ParsedRow,
  type TopicRef,
} from "@/lib/import/parse";
import { MathText } from "@/components/math-text";
import { TASK_TYPE_LABEL, estimateMinutes } from "@/lib/task-types";
import { Button, Notice } from "@/components/ui";
import { importTasksAction, type ImportResult } from "./actions";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Preview {
  fileName: string;
  rows: ParsedRow[];
  /** ZIP-ből: ábrafájl neve → tartalom. */
  figures: Map<string, Uint8Array>;
}

/** Az útvonal utolsó eleme (a ZIP-ben lehetnek almappák). */
function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Fájl beolvasása és előnézet készítése. Hibánál ImportFormatError-t dob. */
async function readImportFile(
  file: File,
  topics: TopicRef[],
  existingTitles: Set<string>,
): Promise<Preview> {
  if (file.size > MAX_FILE_BYTES) throw new ImportFormatError("A fájl legfeljebb 20 MB lehet.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    } catch {
      throw new ImportFormatError("A ZIP fájl nem olvasható.");
    }
    const usable = Object.entries(entries).filter(
      ([path]) => !path.startsWith("__MACOSX/") && !baseName(path).startsWith("."),
    );
    const figures = new Map<string, Uint8Array>();
    for (const [path, bytes] of usable) {
      if (path.toLowerCase().endsWith(".png")) figures.set(baseName(path), bytes);
    }
    const data = usable.find(([path]) => /\.(json|csv)$/i.test(path));
    if (!data) throw new ImportFormatError("A ZIP-ben nincs JSON vagy CSV fájl.");

    const options = { topics, existingTitles, figures: new Set(figures.keys()) };
    const text = strFromU8(data[1]);
    const rows = /\.json$/i.test(data[0]) ? parseJsonImport(text, options) : parseCsvImport(text, options);

    // Hibás PNG-k jelzése soronként (a kiterjesztés hazudhat).
    for (const row of rows) {
      const figure = row.row?.figure;
      const bytes = figure ? figures.get(figure) : undefined;
      if (figure && bytes && !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
        row.errors.push(`Az ábra nem érvényes PNG: „${figure}”.`);
        row.row = undefined;
      }
    }
    return { fileName: file.name, rows, figures };
  }

  const text = await file.text();
  const options = { topics, existingTitles };
  if (name.endsWith(".json")) return { fileName: file.name, rows: parseJsonImport(text, options), figures: new Map() };
  if (name.endsWith(".csv")) return { fileName: file.name, rows: parseCsvImport(text, options), figures: new Map() };
  throw new ImportFormatError("Csak .json, .csv vagy .zip fájl importálható.");
}

/** Egyszerre ennyi fájl választható ki. */
const MAX_FILES = 20;

type FileResult = { fileName: string; count: number };

export function ImportWizard({ topics, existingTitles }: { topics: TopicRef[]; existingTitles: string[] }) {
  // Több fájl (JSON/CSV/ZIP vegyesen): fájlonként külön előnézet és külön import.
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [formatErrors, setFormatErrors] = useState<string[]>([]);
  const [done, setDone] = useState<FileResult[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validOf = (p: Preview) => p.rows.filter((r) => r.row);
  const totalRows = previews.reduce((s, p) => s + p.rows.length, 0);
  const totalValid = previews.reduce((s, p) => s + validOf(p).length, 0);
  const topicName = new Map(topics.map((t) => [t.slug, t.name]));

  async function onFilesChange(list: FileList | null) {
    setPreviews([]);
    setFormatErrors([]);
    setDone(null);
    setImportError(null);
    if (!list || list.length === 0) return;
    const files = [...list].slice(0, MAX_FILES);
    const errors: string[] = list.length > MAX_FILES ? [`Egyszerre legfeljebb ${MAX_FILES} fájl választható; az első ${MAX_FILES} került be.`] : [];
    const result: Preview[] = [];
    // A korábbi fájlok címei is „meglévőnek” számítanak: a fájlok közötti ismétlést is jelezzük.
    const seen = new Set(existingTitles);
    for (const file of files) {
      try {
        const preview = await readImportFile(file, topics, new Set(seen));
        for (const row of preview.rows) if (row.row) seen.add(normalizeKey(row.row.title));
        result.push(preview);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof ImportFormatError ? err.message : "a fájl nem dolgozható fel."}`);
      }
    }
    setPreviews(result);
    setFormatErrors(errors);
  }

  function runImport() {
    if (previews.length === 0) return;
    startTransition(async () => {
      setImportError(null);
      const supabase = createClient();
      const finished: FileResult[] = [];

      // Fájlonként: ábrák feltöltése, majd a sorok beszúrása egy tranzakcióban.
      for (const [index, preview] of previews.entries()) {
        const valid = validOf(preview);
        if (valid.length === 0) continue;
        setProgress(`${index + 1}/${previews.length}: ${preview.fileName}`);
        const rows: ImportRow[] = [];
        for (const parsed of valid) {
          const row = parsed.row!;
          if (!row.figure) {
            rows.push(row);
            continue;
          }
          const bytes = preview.figures.get(row.figure)!;
          const path = `import/${crypto.randomUUID()}.png`;
          const { error } = await supabase.storage
            .from("task-figures")
            .upload(path, new Blob([bytes as BlobPart], { type: "image/png" }), { contentType: "image/png" });
          if (error) {
            setImportError(`${preview.fileName}: az ábra feltöltése nem sikerült („${row.figure}”), ebből a fájlból semmi sem került be.`);
            setDone(finished);
            setProgress(null);
            return;
          }
          rows.push({ ...row, figure: path });
        }
        const result = await importTasksAction(rows);
        if (!result.ok) {
          setImportError(`${preview.fileName}: ${result.message}`);
          setDone(finished);
          setProgress(null);
          return;
        }
        finished.push({ fileName: preview.fileName, count: result.count });
      }
      setProgress(null);
      setDone(finished);
    });
  }

  if (done && !importError) {
    const total = done.reduce((s, d) => s + d.count, 0);
    return (
      <div className="space-y-4">
        <Notice tone="success">
          {total} feladat bekerült a feladatbankba
          {done.length > 1 ? ` (${done.map((d) => `${d.fileName}: ${d.count}`).join("; ")})` : ""}.
        </Notice>
        <div className="flex flex-wrap gap-3">
          <Link href="/tanar/feladatok" className="inline-flex min-h-12 items-center rounded-md bg-ink px-5 font-bold text-white">
            Feladatbank megnyitása
          </Link>
          <Button type="button" variant="secondary" onClick={() => { setPreviews([]); setDone(null); }}>
            Újabb fájlok importálása
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="import-file" className="block font-bold">
          Fájlok kiválasztása (.json, .csv vagy .zip ábrákkal; egyszerre több is)
        </label>
        <input
          id="import-file"
          type="file"
          multiple
          accept=".json,.csv,.zip,application/json,text/csv,application/zip"
          onChange={(e) => onFilesChange(e.target.files)}
          className="block text-sm file:mr-3 file:min-h-12 file:rounded-md file:border file:border-ink/40 file:bg-sheet file:px-4 file:font-bold file:text-ink"
        />
        <p className="text-sm text-muted">
          Fájlonként legfeljebb 1000 feladat és 20 MB. Minden fájl külön kerül be: ha egy hibára fut, az előtte lévők
          már bent vannak.
        </p>
      </div>

      {formatErrors.length ? (
        <Notice tone="error">
          {formatErrors.map((e) => (
            <span key={e} className="block">
              {e}
            </span>
          ))}
        </Notice>
      ) : null}

      {previews.length ? (
        <>
          <Notice tone={totalValid < totalRows ? "warning" : "success"}>
            {previews.length} fájl, {totalRows} feladat, ebből {totalValid} hibátlan
            {totalValid < totalRows ? `, ${totalRows - totalValid} hibás (ezek kimaradnak)` : ""}.
          </Notice>

          {previews.map((preview, fileIndex) => (
            <details key={`${fileIndex}-${preview.fileName}`} open={previews.length === 1} className="space-y-2 rounded-md border border-rule bg-paper p-3">
              <summary className="cursor-pointer font-bold">
                {preview.fileName}: {preview.rows.length} feladat, {validOf(preview).length} hibátlan
                {preview.figures.size ? `, ${preview.figures.size} ábra` : ""}
              </summary>
              <ol className="mt-2 space-y-2">
                {preview.rows.map((row) => (
                  <li
                    key={row.line}
                    className={`rounded-md border p-3 ${row.errors.length ? "border-redpen/50 bg-redpen-soft" : "border-rule bg-sheet"}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-bold">
                        <span className="mr-2 text-sm text-muted">{row.line}.</span>
                        {row.title}
                      </p>
                      {row.row ? (
                        <p className="text-sm text-muted">
                          {row.row.topic_slugs.map((slug) => topicName.get(slug)).join(", ")}, {TASK_TYPE_LABEL[row.row.task_type].toLowerCase()}, nehézség{" "}
                          {row.row.difficulty}, ~{estimateMinutes(row.row.task_type, row.row.difficulty, row.row.est_minutes)} perc{row.row.level === "egyetem" ? ", egyetemi szint" : ""}
                          {row.row.requires_image ? ", fényképpel" : ""}
                          {row.row.figure ? `, ábra: ${row.row.figure}` : ""}
                        </p>
                      ) : (
                        <p className="text-sm font-bold text-redpen">Hibás, kimarad</p>
                      )}
                    </div>
                    {row.errors.length ? (
                      <ul className="mt-1 list-disc pl-5 text-sm text-redpen">
                        {row.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ) : null}
                    {row.warnings.length ? (
                      <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                        {row.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                    {row.row ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm text-ink">Szöveg előnézete</summary>
                        <MathText source={row.row.body_md} className="mt-2" />
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            </details>
          ))}

          {importError ? <Notice tone="error">{importError}</Notice> : null}
          {importError && done?.length ? (
            <Notice tone="warning">Ezek már bekerültek: {done.map((d) => `${d.fileName} (${d.count})`).join("; ")}.</Notice>
          ) : null}
          {progress ? <p className="text-sm text-muted">Importálás: {progress}…</p> : null}

          <Button type="button" onClick={runImport} disabled={pending || totalValid === 0}>
            {pending ? "Importálás…" : `${totalValid} feladat importálása`}
          </Button>
        </>
      ) : null}
    </div>
  );
}
