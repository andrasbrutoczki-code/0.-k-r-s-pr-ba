"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { strFromU8, unzipSync } from "fflate";
import { createClient } from "@/lib/supabase/client";
import {
  ImportFormatError,
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

export function ImportWizard({ topics, existingTitles }: { topics: TopicRef[]; existingTitles: string[] }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = preview?.rows.filter((r) => r.row) ?? [];
  const invalidCount = (preview?.rows.length ?? 0) - valid.length;
  const topicName = new Map(topics.map((t) => [t.slug, t.name]));

  async function onFileChange(file: File | undefined) {
    setPreview(null);
    setFormatError(null);
    setResult(null);
    setUploadError(null);
    if (!file) return;
    try {
      setPreview(await readImportFile(file, topics, new Set(existingTitles)));
    } catch (err) {
      setFormatError(err instanceof ImportFormatError ? err.message : "A fájl nem dolgozható fel.");
    }
  }

  function runImport() {
    if (!preview) return;
    startTransition(async () => {
      setUploadError(null);
      const supabase = createClient();
      const rows: ImportRow[] = [];

      // 1. Ábrák feltöltése közvetlenül a Storage-ba (nem a szerveren át).
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
          setUploadError(`Az ábra feltöltése nem sikerült („${row.figure}”). Semmi sem került be; próbáld újra.`);
          return;
        }
        rows.push({ ...row, figure: path });
      }

      // 2. A sorok beszúrása egy tranzakcióban.
      setResult(await importTasksAction(rows));
    });
  }

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <Notice tone="success">{result.count} feladat bekerült a feladatbankba.</Notice>
        <div className="flex flex-wrap gap-3">
          <Link href="/tanar/feladatok" className="inline-flex min-h-12 items-center rounded-md bg-ink px-5 font-bold text-white">
            Feladatbank megnyitása
          </Link>
          <Button type="button" variant="secondary" onClick={() => { setPreview(null); setResult(null); }}>
            Újabb fájl importálása
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="import-file" className="block font-bold">
          Fájl kiválasztása (.json, .csv vagy .zip ábrákkal)
        </label>
        <input
          id="import-file"
          type="file"
          accept=".json,.csv,.zip,application/json,text/csv,application/zip"
          onChange={(e) => onFileChange(e.target.files?.[0])}
          className="block text-sm file:mr-3 file:min-h-12 file:rounded-md file:border file:border-ink/40 file:bg-sheet file:px-4 file:font-bold file:text-ink"
        />
      </div>

      {formatError ? <Notice tone="error">{formatError}</Notice> : null}

      {preview ? (
        <>
          <Notice tone={invalidCount ? "warning" : "success"}>
            <strong>{preview.fileName}</strong>: {preview.rows.length} feladat, ebből {valid.length} hibátlan
            {invalidCount ? `, ${invalidCount} hibás (ezek kimaradnak)` : ""}.
          </Notice>

          <ol className="space-y-2">
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
                      {row.row.difficulty}, ~{estimateMinutes(row.row.task_type, row.row.difficulty, row.row.est_minutes)} perc
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

          {uploadError ? <Notice tone="error">{uploadError}</Notice> : null}
          {result && !result.ok ? <Notice tone="error">{result.message}</Notice> : null}

          <Button type="button" onClick={runImport} disabled={pending || valid.length === 0}>
            {pending ? "Importálás…" : `${valid.length} feladat importálása`}
          </Button>
        </>
      ) : null}
    </div>
  );
}
