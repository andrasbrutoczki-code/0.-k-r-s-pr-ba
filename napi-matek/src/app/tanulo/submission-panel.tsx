"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { compressImage, ImageDecodeError } from "@/lib/images/compress";
import type { TaskType } from "@/lib/task-types";
import { Button, Notice } from "@/components/ui";
import { ensureDraftAction, submitTaskAction } from "./actions";

const MAX_IMAGES = 8;

interface PanelImage {
  /** submission_images.id, ha már elmentve; feltöltés közben üres. */
  id: string | null;
  key: string;
  path: string | null;
  url: string | null;
  uploading: boolean;
}

/** A félbehagyott szöveges válasz böngészőn belüli megőrzése (kényelmi funkció, nem kötelező). */
function useLocalDraft(key: string) {
  const read = (): { choice: string | null; answer: string } => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as { choice: string | null; answer: string };
    } catch {
      // privát mód vagy tiltott tárhely: nincs mentés, a működés nem függ tőle
    }
    return { choice: null, answer: "" };
  };
  const write = (value: { choice: string | null; answer: string }) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // lásd fent
    }
  };
  const clear = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // lásd fent
    }
  };
  return { read, write, clear };
}

/**
 * A beadás felülete. Típusonként:
 *   teszt    – betűjel-gombok + rövid indoklás
 *   rovid    – válasz szövegesen
 *   kifejtos – fénykép(ek): kamera vagy galéria, tömörítve, előnézettel
 * A „Kész” gomb adja be a feladatot; utána megjelenik a biztató üzenet.
 *
 * Mindig ugyanazon a helyen renderelődik (akkor is, ha a feladat már nem
 * szerkeszthető), hogy a beadás utáni frissítés ne tüntesse el a biztató üzenetet.
 */
export function SubmissionPanel({
  studentId,
  studentTaskId,
  type,
  requiresImage,
  letters,
  editable,
  isRevision,
  draft,
}: {
  studentId: string;
  studentTaskId: string;
  type: TaskType;
  requiresImage: boolean;
  letters: string[];
  editable: boolean;
  isRevision: boolean;
  draft: { id: string; images: { id: string; path: string; url: string | null }[] } | null;
}) {
  const router = useRouter();
  const ids = useId();
  const local = useLocalDraft(`napi-matek:valasz:${studentTaskId}`);
  const draftIdRef = useRef<string | null>(draft?.id ?? null);
  const [images, setImages] = useState<PanelImage[]>(
    () => draft?.images.map((i) => ({ id: i.id, key: i.id, path: i.path, url: i.url, uploading: false })) ?? [],
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [encouragement, setEncouragement] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const doneRef = useRef<HTMLDivElement>(null);

  // A megkezdett válasz visszatöltése (csak a böngészőben, a hidratálás után).
  useEffect(() => {
    const saved = local.read();
    setChoice(saved.choice);
    setAnswer(saved.answer);
  }, []); // csak egyszer, a felcsatoláskor

  useEffect(() => {
    if (encouragement) doneRef.current?.focus();
  }, [encouragement]);

  const uploading = images.some((i) => i.uploading);
  const usesText = type === "teszt" || type === "rovid" || !requiresImage;
  const showPhotos = requiresImage || type === "kifejtos";

  if (encouragement) {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="space-y-1 rounded-md border-2 border-ok bg-ok-soft p-4 text-center"
      >
        <p className="text-2xl" aria-hidden="true">
          ✓
        </p>
        <p className="text-lg font-bold text-ok">{encouragement}</p>
        <p className="text-sm text-muted">Beadva. A tanárod hamarosan megnézi.</p>
      </div>
    );
  }
  if (!editable) return null;

  function remember(next: { choice?: string | null; answer?: string }) {
    const value = { choice: next.choice !== undefined ? next.choice : choice, answer: next.answer ?? answer };
    local.write(value);
  }

  async function ensureDraft(): Promise<string | null> {
    if (draftIdRef.current) return draftIdRef.current;
    const result = await ensureDraftAction(studentTaskId);
    if (!result.ok) {
      setError(result.message);
      return null;
    }
    draftIdRef.current = result.draftId;
    return result.draftId;
  }

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = [...fileList].slice(0, Math.max(0, MAX_IMAGES - images.length));
    if (files.length < fileList.length) setError(`Legfeljebb ${MAX_IMAGES} kép tölthető fel egy feladathoz.`);

    const draftId = await ensureDraft();
    if (!draftId) return;
    const supabase = createClient();
    let position = images.length;

    for (const file of files) {
      position += 1;
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      setImages((prev) => [...prev, { id: null, key, path: null, url: preview, uploading: true }]);
      try {
        const { blob, width, height } = await compressImage(file);
        const path = `${studentId}/${studentTaskId}/${key}.jpg`;
        const upload = await supabase.storage
          .from("submissions")
          .upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (upload.error) throw new Error("upload");
        const { data, error: insertError } = await supabase
          .from("submission_images")
          .insert({ submission_id: draftId, storage_path: path, width, height, position })
          .select("id")
          .single<{ id: string }>();
        if (insertError || !data) {
          await supabase.storage.from("submissions").remove([path]);
          throw new Error("insert");
        }
        setImages((prev) => prev.map((i) => (i.key === key ? { ...i, id: data.id, path, uploading: false } : i)));
      } catch (err) {
        URL.revokeObjectURL(preview);
        setImages((prev) => prev.filter((i) => i.key !== key));
        setError(
          err instanceof ImageDecodeError
            ? err.message
            : "A kép feltöltése nem sikerült. Ellenőrizd az internetkapcsolatot, és próbáld újra.",
        );
      }
    }
  }

  async function removeImage(image: PanelImage) {
    if (!image.id || !image.path) return;
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("submission_images").delete().eq("id", image.id);
    if (deleteError) {
      setError("A kép nem törölhető.");
      return;
    }
    await supabase.storage.from("submissions").remove([image.path]);
    setImages((prev) => prev.filter((i) => i.key !== image.key));
  }

  function submit() {
    setError(null);
    startSubmit(async () => {
      const result = await submitTaskAction(studentTaskId, type === "teszt" ? choice : null, usesText ? answer : null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      local.clear();
      setEncouragement(result.encouragement);
      router.refresh();
    });
  }

  const savedImages = images.filter((i) => !i.uploading).length;
  const missing =
    (type === "teszt" && (!choice || answer.trim().length < 3)) ||
    (type === "rovid" && !answer.trim()) ||
    (requiresImage && savedImages === 0);

  return (
    <div className="space-y-4 border-t border-rule pt-4">
      {isRevision ? (
        <Notice tone="warning">A tanárod javítást kért. Nézd meg a megjegyzését, és add be újra.</Notice>
      ) : null}

      {type === "teszt" ? (
        <fieldset className="space-y-2">
          <legend className="font-bold">A válaszod</legend>
          <div className="flex flex-wrap gap-2">
            {letters.map((letter) => (
              <button
                key={letter}
                type="button"
                aria-pressed={choice === letter}
                onClick={() => {
                  setChoice(letter);
                  remember({ choice: letter });
                }}
                className={`h-14 w-14 rounded-md border-2 text-xl font-bold ${
                  choice === letter ? "border-ink bg-ink text-white" : "border-rule bg-sheet text-graphite"
                }`}
              >
                {letter}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {usesText ? (
        <div className="space-y-1.5">
          <label htmlFor={`${ids}-answer`} className="block font-bold">
            {type === "teszt" ? "Rövid indoklás" : type === "rovid" ? "Az eredmény" : "Megjegyzés (nem kötelező)"}
          </label>
          <textarea
            id={`${ids}-answer`}
            rows={type === "rovid" ? 2 : 3}
            maxLength={5000}
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              remember({ answer: e.target.value });
            }}
            placeholder={type === "teszt" ? "Miért ez a jó válasz? Egy-két mondat elég." : undefined}
            className="block w-full rounded-md border border-rule bg-sheet px-3 py-2 text-graphite focus:border-ink"
          />
        </div>
      ) : null}

      {showPhotos ? (
        <div className="space-y-3">
          <p className="font-bold">
            Fénykép a megoldásodról{requiresImage ? "" : " (nem kötelező)"}
          </p>
          {images.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((image, index) => (
                <li key={image.key} className="relative">
                  {image.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- helyi előnézet vagy lejáró aláírt URL
                    <img
                      src={image.url}
                      alt={`${index + 1}. fénykép`}
                      className={`aspect-[3/4] w-full rounded-md border border-rule object-cover ${image.uploading ? "opacity-50" : ""}`}
                    />
                  ) : (
                    <div className="aspect-[3/4] w-full rounded-md border border-rule bg-paper" />
                  )}
                  {image.uploading ? (
                    <span className="absolute inset-x-0 bottom-1 text-center text-xs font-bold text-ink">Feltöltés…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeImage(image)}
                      className="absolute right-1 top-1 h-9 w-9 rounded-full bg-sheet/90 text-lg font-bold text-redpen shadow"
                      aria-label={`${index + 1}. fénykép törlése`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md bg-ink px-5 font-bold text-white">
              <span aria-hidden="true">📷</span> {images.length ? "Újabb fotó" : "Fotó készítése"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={uploading || images.length >= MAX_IMAGES}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="inline-flex min-h-12 cursor-pointer items-center rounded-md border border-ink/40 bg-sheet px-5 font-bold text-ink">
              Kép a galériából
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="sr-only"
                disabled={uploading || images.length >= MAX_IMAGES}
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      ) : null}

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button
        type="button"
        onClick={submit}
        disabled={submitting || uploading || missing}
        className="w-full bg-ok text-lg hover:bg-ok/90 disabled:bg-ok/40 sm:w-auto"
      >
        {submitting ? "Beadás…" : "✓ Kész, beadom"}
      </Button>
      {missing && !submitting ? (
        <p className="text-sm text-muted">
          {type === "teszt"
            ? "A beadáshoz jelöld meg a választ, és írj rövid indoklást."
            : type === "rovid"
              ? "A beadáshoz írd be az eredményt."
              : "A beadáshoz tölts fel legalább egy fényképet."}
        </p>
      ) : null}
    </div>
  );
}
