"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { MathText } from "@/components/math-text";
import { Button, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/dates";

/** Az Edge Function által mentett javaslat (lásd supabase/functions/ai-review/prompt.ts). */
export interface AiReview {
  id: string;
  created_at: string;
  model: string;
  result: {
    verdict: "accepted" | "needs_revision" | "unsure";
    confidence: "high" | "medium" | "low";
    summary: string;
    issues: { severity: "hiba" | "hianyossag" | "apro"; location?: string; description: string }[];
    unreadable?: string;
    ai_correct_choice?: string;
    feedback_md: string;
  };
}

const VERDICT = {
  accepted: { label: "Elfogadást javasol", className: "bg-ok text-white" },
  needs_revision: { label: "Javítást javasol", className: "bg-redpen text-white" },
  unsure: { label: "Nem tudja megítélni", className: "bg-rule text-ink" },
} as const;
const CONFIDENCE = { high: "biztos", medium: "közepesen biztos", low: "bizonytalan" } as const;
const SEVERITY = { hiba: "Hiba", hianyossag: "Hiányosság", apro: "Apróság" } as const;

/**
 * AI-javaslat a beadásra. A javaslat soha nem jut el magától a tanulóhoz:
 * a tanár átveheti a szöveget a visszajelzés mezőbe, ott átírhatja, és ő dönt.
 */
export function AiPanel({
  studentTaskId,
  initial,
  remaining,
  allowed,
  onUseText,
}: {
  studentTaskId: string;
  initial: AiReview | null;
  /** Ennyi javaslat kérhető még a legutóbbi beadott változatra. */
  remaining: number;
  /** Van-e hozzájárulás (Tanulók oldal). */
  allowed: boolean;
  onUseText: (text: string) => void;
}) {
  const router = useRouter();
  const [review, setReview] = useState<AiReview | null>(initial);
  const [left, setLeft] = useState(remaining);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function request() {
    start(async () => {
      setError(null);
      const { data, error: invokeError } = await createClient().functions.invoke<{ review: AiReview }>("ai-review", {
        body: { student_task_id: studentTaskId },
      });
      if (invokeError) {
        let message = "Az AI-elemzés nem sikerült. Próbáld újra.";
        if (invokeError instanceof FunctionsHttpError) {
          try {
            const body = (await invokeError.context.json()) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            // nem JSON válasz: marad az általános üzenet
          }
        }
        setError(message);
        return;
      }
      if (data?.review) {
        setReview(data.review);
        setLeft((n) => n - 1);
        router.refresh();
      }
    });
  }

  const result = review?.result;

  if (!allowed && !review) {
    return (
      <section className="rounded-md border border-rule bg-sheet p-3 text-sm text-muted" aria-label="AI-javaslat">
        <strong className="text-ink">AI-asszisztens:</strong> ennél a tanulónál nincs rögzítve hozzájárulás.
        A Tanulók oldalon kapcsolható be.
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-ink/30 bg-ink-soft p-3" aria-label="AI-javaslat">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">AI-asszisztens</h3>
        <Button type="button" variant="secondary" disabled={pending || left <= 0 || !allowed} onClick={request}>
          {pending ? "Elemzés…" : review ? "Új javaslat kérése" : "AI-javaslat kérése"}
        </Button>
      </div>
      {pending ? (
        <p className="text-sm text-muted">Az AI elolvassa a feladatot és a beadást. Fotókkal 20–60 másodperc is lehet.</p>
      ) : null}
      {!review && !pending ? (
        <p className="text-sm text-muted">
          Elolvassa a feladatot, a megoldási útmutatót, a tanuló válaszát és fotóit, majd döntést és
          visszajelzés-tervezetet javasol. A tanuló ebből semmit nem lát.
        </p>
      ) : null}
      {left <= 0 ? (
        <p className="text-sm text-muted">Ehhez a beadáshoz már nem kérhető több javaslat (új beadásnál újra lehet).</p>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {review && result ? (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-sm font-bold ${VERDICT[result.verdict].className}`}>
              {VERDICT[result.verdict].label}
            </span>
            <span className="text-sm text-muted">({CONFIDENCE[result.confidence]})</span>
          </p>
          {result.summary ? <p>{result.summary}</p> : null}
          {result.ai_correct_choice ? (
            <p className="text-sm">
              Helyes válasz nincs megadva a feladatnál; az AI szerint: <strong>{result.ai_correct_choice}</strong>.
              Érdemes felvenni a feladatbankban.
            </p>
          ) : null}
          {result.issues.length ? (
            <ul className="space-y-1.5">
              {result.issues.map((issue, i) => (
                <li key={i} className="text-sm">
                  <strong className={issue.severity === "apro" ? "text-muted" : "text-redpen"}>
                    {SEVERITY[issue.severity]}
                    {issue.location ? ` (${issue.location})` : ""}:
                  </strong>{" "}
                  <MathText source={issue.description} className="inline" />
                </li>
              ))}
            </ul>
          ) : null}
          {result.unreadable ? (
            <Notice tone="warning">Nem olvasható: {result.unreadable}</Notice>
          ) : null}
          <div className="rounded-md border border-dashed border-rule bg-sheet px-3 py-2">
            <p className="mb-1 text-xs font-bold text-muted">Visszajelzés-tervezet a tanulónak</p>
            <MathText source={result.feedback_md} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="secondary" onClick={() => onUseText(result.feedback_md)}>
              Szöveg átvétele a visszajelzésbe
            </Button>
            <span className="text-xs text-muted">
              {formatDateTime(review.created_at)} · {review.model}. Az AI tévedhet: ellenőrizd, mielőtt döntesz.
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
