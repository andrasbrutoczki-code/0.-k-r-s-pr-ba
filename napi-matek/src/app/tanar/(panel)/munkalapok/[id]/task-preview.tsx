"use client";

import { useState } from "react";
import { MathText } from "@/components/math-text";
import { getTaskPreviewAction, type TaskPreview as Preview } from "../actions";

/**
 * Lenyitható feladat-előnézet a munkalap-szerkesztőben: a szöveg, az ábra és
 * (csak a tanárnak) a helyes válasz és az útmutató. Első lenyitáskor tölt be,
 * így a több száz soros listák nem lassulnak.
 */
export function TaskPreview({ taskId }: { taskId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function load() {
    if (preview || state === "loading") return;
    setState("loading");
    const result = await getTaskPreviewAction(taskId);
    if (result) {
      setPreview(result);
      setState("idle");
    } else {
      setState("error");
    }
  }

  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="cursor-pointer text-sm font-bold text-ink">Feladat megtekintése</summary>
      <div className="mt-2 space-y-2 rounded-md border border-rule bg-paper p-3 text-[0.95rem]">
        {state === "loading" ? <p className="text-sm text-muted">Betöltés…</p> : null}
        {state === "error" ? <p className="text-sm text-redpen">A feladat nem tölthető be.</p> : null}
        {preview ? (
          <>
            <MathText source={preview.body_md} />
            {preview.figureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL
              <img src={preview.figureUrl} alt="A feladat ábrája" className="max-h-60 rounded border border-rule bg-white" />
            ) : null}
            {preview.correct_choice ? (
              <p className="text-sm">
                Helyes válasz: <strong>{preview.correct_choice}</strong>
              </p>
            ) : null}
            {preview.solution_md ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-redpen">Megoldási útmutató</summary>
                <MathText source={preview.solution_md} className="mt-1" />
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
