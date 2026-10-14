"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MathText } from "@/components/math-text";
import { Button, Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import type { ThreadMessage } from "@/lib/student/tasks";
import { sendMessageAction } from "./actions";

/** Időbélyeges üzenetváltás a tanárral egy feladatnál. */
export function MessageThread({ studentTaskId, messages }: { studentTaskId: string; messages: ThreadMessage[] }) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    start(async () => {
      setError(null);
      const result = await sendMessageAction(studentTaskId, text);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setText("");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 border-t border-rule pt-4" aria-label="Üzenetek a tanároddal">
      <h3 className="font-bold">Üzenetek</h3>
      {messages.length === 0 ? (
        <p className="text-sm text-muted">Ha elakadtál, írj a tanárodnak.</p>
      ) : (
        <ol className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-md border p-3 ${
                m.fromTeacher ? "border-redpen/40 bg-redpen-soft" : "ml-6 border-ink/30 bg-ink-soft"
              }`}
            >
              <p className="mb-1 text-xs font-bold text-muted">
                {m.fromTeacher ? "Tanár" : "Te"}, {formatDateTime(m.createdAt)}
              </p>
              <MathText source={m.body} />
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <label htmlFor={`${id}-msg`} className="sr-only">
          Üzenet a tanárnak
        </label>
        <textarea
          id={`${id}-msg`}
          rows={2}
          maxLength={5000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Üzenet a tanárnak (képlet: $x^2$)"
          className="block w-full rounded-md border border-rule bg-sheet px-3 py-2 focus:border-ink"
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="button" variant="secondary" onClick={send} disabled={pending || !text.trim()}>
          {pending ? "Küldés…" : "Üzenet küldése"}
        </Button>
      </div>
    </section>
  );
}
