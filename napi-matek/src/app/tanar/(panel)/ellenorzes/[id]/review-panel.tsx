"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MathText } from "@/components/math-text";
import { Button, Notice } from "@/components/ui";
import type { TaskStatus } from "@/lib/tasks";
import {
  decisionAction,
  openForReviewAction,
  reopenAction,
  teacherMessageAction,
  type ReviewResult,
} from "../actions";

/**
 * Megnyitáskor (a böngészőben, nem a szerveroldali rendereléskor – így egy
 * link-előtöltés nem változtat állapotot): Beadva → Javítás alatt, és a
 * tanuló üzenetei olvasottak lesznek.
 */
export function OpenOnMount({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    void openForReviewAction(id).then(({ changed }) => {
      if (changed) router.refresh();
    });
  }, [id, router]);
  return null;
}

/**
 * Visszajelzés és döntés. A szöveg LaTeX-et is tartalmazhat ($…$), élő előnézettel.
 *   Elfogadva  – a feladat kész
 *   Javítandó  – a tanuló új változatot adhat be
 *   Csak üzenet – döntés nélkül (állapot: Visszajelzés elküldve)
 */
export function ReviewPanel({ id, status }: { id: string; status: TaskStatus }) {
  const router = useRouter();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<ReviewResult>, clear = true) {
    start(async () => {
      setResult(null);
      const r = await action();
      setResult(r);
      if (r.ok) {
        if (clear) setText("");
        router.refresh();
      }
    });
  }

  if (status === "not_started") {
    return <p className="text-muted">A tanuló még nem adta be ezt a feladatot. Üzenetet így is küldhetsz neki.</p>;
  }

  return (
    <div className="space-y-3">
      <label htmlFor={fieldId} className="block font-bold">
        Visszajelzés a tanulónak
      </label>
      <textarea
        id={fieldId}
        rows={4}
        maxLength={5000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Pl.: A b) részben a $\sin 60^\circ$ értéke $\frac{\sqrt3}{2}$."
        className="block w-full rounded-md border border-rule bg-sheet px-3 py-2 focus:border-ink"
      />
      {text.trim() ? (
        <div className="rounded-md border border-dashed border-rule bg-sheet px-3 py-2">
          <p className="mb-1 text-xs font-bold text-muted">Előnézet</p>
          <MathText source={text} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === "accepted" ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => reopenAction(id), false)}>
            Visszanyitás
          </Button>
        ) : (
          <>
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => decisionAction(id, "accepted", text))}
              className="bg-ok hover:bg-ok/90"
            >
              ✓ Elfogadva
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => run(() => decisionAction(id, "needs_revision", text))}
            >
              Javítandó
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !text.trim()}
          onClick={() => run(() => teacherMessageAction(id, text))}
        >
          Csak üzenet küldése
        </Button>
      </div>
      <p className="text-xs text-muted">
        A döntés mellé írt szöveg is a tanuló üzenetszálába kerül, időbélyeggel.
      </p>
      {result && !result.ok ? <Notice tone="error">{result.message}</Notice> : null}
      {result?.ok ? <Notice tone="success">Elmentve.</Notice> : null}
    </div>
  );
}
