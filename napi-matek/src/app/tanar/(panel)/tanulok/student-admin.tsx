"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createStudentAction,
  deleteStudentAction,
  regenerateCodeAction,
  setDisabledAction,
  type CodeResult,
  type DeleteResult,
} from "./actions";
import { formatCode } from "@/lib/auth/code";
import { Button, Field, Input, Notice } from "@/components/ui";

/**
 * Az egyszer látható belépőkód. A kódot az adatbázis csak hash-ként tárolja,
 * ezért ez az egyetlen pillanat, amikor a tanár elolvashatja.
 */
function CodeReveal({ result }: { result: Extract<CodeResult, { status: "code" }> }) {
  const [copied, setCopied] = useState(false);
  const formatted = formatCode(result.code);
  const ref = useRef<HTMLDivElement>(null);

  // A megjelenő kódra visszük a fókuszt, hogy a képernyőolvasó is felolvassa.
  useEffect(() => ref.current?.focus(), []);

  async function copy() {
    try {
      // Csak a kód kerül a vágólapra: így a tanuló közvetlenül a kódmezőbe illesztheti.
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="space-y-3 rounded-md border-2 border-ok bg-ok-soft p-4"
      aria-live="polite"
    >
      <p className="font-bold text-ok">
        {result.isNew
          ? `${result.studentName} felvéve. A belépőkódja:`
          : `${result.studentName} új belépőkódja:`}
      </p>
      <p className="login-code text-graphite" aria-label={`Belépőkód: ${[...result.code].join(" ")}`}>
        {formatted}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? "Kód kimásolva" : "Kód másolása"}
        </Button>
      </div>
      <p className="text-sm text-muted">
        Ezt a kódot csak most látod. Add át a tanulónak; ha elveszik, generálj újat.
        {result.isNew ? null : " A korábbi kód és minden bejelentkezett eszköze már érvénytelen."}
      </p>
    </div>
  );
}

const initialResult: CodeResult = { status: "idle" };

function ResultView({ result }: { result: CodeResult }) {
  if (result.status === "error") return <Notice tone="error">{result.message}</Notice>;
  if (result.status === "code") return <CodeReveal key={result.code} result={result} />;
  return null;
}

/** Új tanuló: egy mező, egy gomb – a kód azonnal megjelenik. */
export function CreateStudentForm() {
  const [result, formAction, pending] = useActionState(createStudentAction, initialResult);
  const formRef = useRef<HTMLFormElement>(null);

  // Siker után ürítjük a mezőt, hogy a következő tanuló azonnal felvehető legyen.
  useEffect(() => {
    if (result.status === "code") formRef.current?.reset();
  }, [result]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field
            label="Új tanuló neve vagy beceneve"
            htmlFor="new-student-name"
            hint="Ezzel a névvel lép be. Elég a becenév is – így kevesebb személyes adatot tárolunk."
          >
            <Input id="new-student-name" name="name" required maxLength={40} autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" disabled={pending} className="sm:mb-7">
          {pending ? "Létrehozás…" : "Tanuló létrehozása"}
        </Button>
      </form>
      <ResultView result={result} />
    </div>
  );
}

/** „Új kód” gomb egy tanuló sorában, megerősítéssel. */
export function RegenerateCodeForm({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [result, formAction, pending] = useActionState(regenerateCodeAction, initialResult);

  return (
    <div className="space-y-3">
      <form
        action={formAction}
        onSubmit={(e) => {
          const ok = window.confirm(
            `Új kódot generálsz ${studentName} számára. A régi kód és minden bejelentkezett eszköze azonnal érvénytelen lesz. Folytatod?`,
          );
          if (!ok) e.preventDefault();
        }}
      >
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="studentName" value={studentName} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Generálás…" : "Új kód"}
        </Button>
      </form>
      <ResultView result={result} />
    </div>
  );
}

/** Letiltás / engedélyezés gomb; letiltás előtt megerősítést kér. */
export function DisableForm({
  studentId,
  studentName,
  disabled,
}: {
  studentId: string;
  studentName: string;
  disabled: boolean;
}) {
  return (
    <form
      action={setDisabledAction}
      onSubmit={(e) => {
        if (disabled) return;
        const ok = window.confirm(
          `${studentName} letiltása: azonnal kilép minden eszközéről, és nem tud belépni, amíg vissza nem engedélyezed. Folytatod?`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="disabled" value={disabled ? "false" : "true"} />
      <Button type="submit" variant={disabled ? "secondary" : "danger"}>
        {disabled ? "Engedélyezés" : "Letiltás"}
      </Button>
    </form>
  );
}

const initialDelete: DeleteResult = { status: "idle" };

/**
 * Végleges törlés – csak letiltott tanulónál jelenik meg. A megerősítéshez be
 * kell írni a tanuló nevét, mert a művelet nem vonható vissza.
 */
export function DeleteStudentForm({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [result, formAction, pending] = useActionState(deleteStudentAction, initialDelete);

  return (
    <div className="space-y-3">
      <form
        action={formAction}
        onSubmit={(e) => {
          const typed = window.prompt(
            `${studentName} végleges törlése: a neve, a belépései, a kiosztott feladatai, a feltöltött képei és az üzenetei is törlődnek. Ez nem vonható vissza.\n\nA megerősítéshez írd be a tanuló nevét:`,
          );
          if (typed?.trim().toLowerCase() !== studentName.trim().toLowerCase()) e.preventDefault();
        }}
      >
        <input type="hidden" name="studentId" value={studentId} />
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Törlés…" : "Végleges törlés"}
        </Button>
      </form>
      {result.status === "error" ? <Notice tone="error">{result.message}</Notice> : null}
    </div>
  );
}
