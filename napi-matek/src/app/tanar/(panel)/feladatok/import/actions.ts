"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/lib/auth/guards";
import { MAX_IMPORT_ROWS, validateRecord, type ImportRow, type TopicRef } from "@/lib/import/parse";

export type ImportResult = { ok: true; count: number } | { ok: false; message: string };

/** A kliens által feltöltött ábrák útvonala: import/<uuid>.png */
const FIGURE_PATH = /^import\/[0-9a-f-]{36}\.png$/;

/**
 * Az előnézetben jóváhagyott sorok beszúrása. A kliensnek nem hiszünk:
 * ugyanazzal a validálóval újraellenőrzünk, és az adatbázis egy
 * tranzakcióban szúr be (vagy minden sor bekerül, vagy egy sem).
 *
 * `rows`: ImportRow-k, ahol a `figure` már a Storage-útvonal (a böngésző töltötte fel).
 */
export async function importTasksAction(rows: ImportRow[]): Promise<ImportResult> {
  const { supabase } = await requireTeacher();

  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, message: "Nincs importálható sor." };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, message: `Legfeljebb ${MAX_IMPORT_ROWS} sor importálható.` };

  const { data: topicData } = await supabase.from("topics").select("slug, name");
  const topics = (topicData ?? []) as TopicRef[];

  const payload: {
    title: string;
    body_md: string;
    topic_slug: string;
    difficulty: number;
    requires_image: boolean;
    figure_path: string | null;
    solution_md: string | null;
  }[] = [];
  for (const [index, row] of rows.entries()) {
    const figurePath = row.figure ?? "";
    if (figurePath && !FIGURE_PATH.test(figurePath)) {
      return { ok: false, message: `${index + 1}. sor: érvénytelen ábra-útvonal.` };
    }
    // Az ábrát itt már útvonalként kapjuk, ezért a fájlnév-ellenőrzést kihagyjuk.
    const checked = validateRecord(
      {
        cim: row.title,
        szoveg: row.body_md,
        temakor: row.topic_slug,
        nehezseg: row.difficulty,
        kep_kell: row.requires_image,
        megoldasi_utmutato: row.solution_md ?? "",
      },
      index + 1,
      { topics },
    );
    if (!checked.row) {
      return { ok: false, message: `${index + 1}. sor: ${checked.errors.join(" ")}` };
    }
    payload.push({
      title: checked.row.title,
      body_md: checked.row.body_md,
      topic_slug: checked.row.topic_slug,
      difficulty: checked.row.difficulty,
      requires_image: checked.row.requires_image,
      figure_path: figurePath || null,
      solution_md: checked.row.solution_md ?? null,
    });
  }

  const { data, error } = await supabase.rpc("import_tasks", { p_rows: payload });
  if (error) return { ok: false, message: "Az import nem sikerült, egyetlen feladat sem került be." };

  revalidatePath("/tanar/feladatok");
  return { ok: true, count: Number(data) };
}
