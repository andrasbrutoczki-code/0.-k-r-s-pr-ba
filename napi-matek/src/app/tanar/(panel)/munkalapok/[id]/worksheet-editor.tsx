"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  addItemAction,
  assignWorksheetAction,
  duplicateWorksheetAction,
  moveItemAction,
  removeItemAction,
  updateItemSlotAction,
  updateWorksheetAction,
  type ActionResult,
  type AssignResult,
} from "../actions";
import { Button, Difficulty, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { PRACTICE_DAYS, formatDayWithWeekday, isoWeekday, scheduledDate } from "@/lib/schedule";

export interface EditorItem {
  id: string;
  position: number;
  week_no: number;
  day_no: number;
  task: { id: string; title: string; difficulty: number; topicName: string; archived: boolean };
}

export interface PickerTask {
  id: string;
  title: string;
  difficulty: number;
  topicId: number;
}

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1);

/** Egy szerveroldali művelet futtatása átmenetként, a hibaüzenet megjelenítésével. */
function useServerAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.message);
    });
  return { pending, error, run };
}

// -----------------------------------------------------------------------------
// Cím és leírás
// -----------------------------------------------------------------------------

export function WorksheetMetaForm({ id, title, description }: { id: string; title: string; description: string }) {
  const [state, formAction, pending] = useActionState(updateWorksheetAction, null);
  const [values, setValues] = useState({ title, description });

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Field label="Cím" htmlFor="ws-title">
        <Input
          id="ws-title"
          name="title"
          required
          maxLength={120}
          value={values.title}
          onChange={(e) => setValues({ ...values, title: e.target.value })}
        />
      </Field>
      <Field label="Megjegyzés (csak te látod)" htmlFor="ws-desc">
        <Textarea
          id="ws-desc"
          name="description"
          rows={2}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          className="font-sans"
        />
      </Field>
      {state && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      {state?.ok ? <Notice tone="success">Mentve.</Notice> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Mentés…" : "Cím és megjegyzés mentése"}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Tételek: sorrend és ütemezés
// -----------------------------------------------------------------------------

export function ItemsEditor({ worksheetId, items }: { worksheetId: string; items: EditorItem[] }) {
  const { pending, error, run } = useServerAction();

  if (items.length === 0) {
    return <p className="text-muted">A munkalap még üres. Adj hozzá feladatokat a feladatbankból (lent).</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ol className={`space-y-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        {items.map((item, index) => (
          <li key={item.id} className="rounded-md border border-rule bg-sheet p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-bold">
                <span className="mr-2 text-muted">{index + 1}.</span>
                {item.task.title}
                {item.task.archived ? <span className="ml-2 text-sm text-redpen">(archivált)</span> : null}
              </p>
              <span className="flex items-center gap-2 text-sm text-muted">
                {item.task.topicName} <Difficulty value={item.task.difficulty} />
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block font-bold">Hét</span>
                <Select
                  aria-label={`${item.task.title}: hét`}
                  value={item.week_no}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => updateItemSlotAction(worksheetId, item.id, Number(e.target.value), item.day_no))
                  }
                  className="w-24"
                >
                  {WEEKS.map((w) => (
                    <option key={w} value={w}>
                      {w}.
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-sm">
                <span className="block font-bold">Nap</span>
                <Select
                  aria-label={`${item.task.title}: nap`}
                  value={item.day_no}
                  disabled={pending}
                  onChange={(e) =>
                    run(() => updateItemSlotAction(worksheetId, item.id, item.week_no, Number(e.target.value)))
                  }
                  className="w-40"
                >
                  {PRACTICE_DAYS.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                      {i === 5 ? " (ismétlés)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="px-3"
                  disabled={pending || index === 0}
                  aria-label={`${item.task.title}: feljebb`}
                  onClick={() => run(() => moveItemAction(worksheetId, item.id, -1))}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="px-3"
                  disabled={pending || index === items.length - 1}
                  aria-label={`${item.task.title}: lejjebb`}
                  onClick={() => run(() => moveItemAction(worksheetId, item.id, 1))}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="px-3"
                  disabled={pending}
                  onClick={() => run(() => removeItemAction(worksheetId, item.id))}
                >
                  Eltávolítás
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Feladatválasztó a feladatbankból
// -----------------------------------------------------------------------------

export function TaskPicker({
  worksheetId,
  tasks,
  topics,
  usedTaskIds,
}: {
  worksheetId: string;
  tasks: PickerTask[];
  topics: { id: number; name: string }[];
  usedTaskIds: string[];
}) {
  const { pending, error, run } = useServerAction();
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState("");
  const used = useMemo(() => new Set(usedTaskIds), [usedTaskIds]);
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  const filtered = tasks.filter(
    (t) =>
      (!topicId || String(t.topicId) === topicId) &&
      (!query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Keresés" htmlFor="picker-q">
          <Input id="picker-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Feladat címe" />
        </Field>
        <Field label="Témakör" htmlFor="picker-topic">
          <Select id="picker-topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">Mind</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {filtered.length === 0 ? <p className="text-muted">Nincs a keresésnek megfelelő feladat.</p> : null}
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
        {filtered.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3 rounded-md border border-rule bg-sheet px-3 py-1">
            <span>
              <span className="font-bold">{task.title}</span>
              <span className="ml-2 text-sm text-muted">{topicName.get(task.topicId)}</span>
              {used.has(task.id) ? <span className="ml-2 text-sm text-ok">már a munkalapon</span> : null}
            </span>
            <span className="flex items-center gap-3">
              <Difficulty value={task.difficulty} />
              <Button
                type="button"
                variant="secondary"
                className="px-3"
                disabled={pending}
                onClick={() => run(() => addItemAction(worksheetId, task.id))}
              >
                Hozzáadás
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Másolás és sablon
// -----------------------------------------------------------------------------

export function DuplicateButtons({ worksheetId, isTemplate }: { worksheetId: string; isTemplate: boolean }) {
  const { pending, error, run } = useServerAction();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => duplicateWorksheetAction(worksheetId, false))}>
          {isTemplate ? "Új munkalap a sablonból" : "Másolat készítése"}
        </Button>
        {isTemplate ? null : (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => duplicateWorksheetAction(worksheetId, true))}>
            Mentés sablonként
          </Button>
        )}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Csoportos kiosztás
// -----------------------------------------------------------------------------

const initialAssign: AssignResult = { status: "idle" };

export function AssignPanel({
  worksheetId,
  students,
  defaultStart,
  items,
}: {
  worksheetId: string;
  students: { id: string; name: string }[];
  defaultStart: string;
  items: EditorItem[];
}) {
  const [state, formAction, pending] = useActionState(assignWorksheetAction, initialAssign);
  const [start, setStart] = useState(defaultStart);
  const [selected, setSelected] = useState<string[]>([]);

  const startIsMonday = /^\d{4}-\d{2}-\d{2}$/.test(start) && isoWeekday(start) === 1;
  const lastItem = items.reduce<EditorItem | null>(
    (latest, item) =>
      !latest || item.week_no * 10 + item.day_no > latest.week_no * 10 + latest.day_no ? item : latest,
    null,
  );

  if (students.length === 0) {
    return (
      <p className="text-muted">
        Nincs aktív tanulód. <Link href="/tanar/tanulok" className="font-bold text-ink">Vegyél fel tanulót</Link>, utána
        oszthatod ki a munkalapot.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="worksheet_id" value={worksheetId} />

      <fieldset className="space-y-2">
        <legend className="font-bold">Tanulók</legend>
        <div className="flex flex-wrap gap-2">
          {students.map((s) => (
            <label
              key={s.id}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft"
            >
              <input
                type="checkbox"
                name="student_ids"
                value={s.id}
                checked={selected.includes(s.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...selected, s.id] : selected.filter((id) => id !== s.id))
                }
                className="h-5 w-5"
              />
              {s.name}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="text-sm font-bold text-ink underline-offset-4 hover:underline"
          onClick={() => setSelected(selected.length === students.length ? [] : students.map((s) => s.id))}
        >
          {selected.length === students.length ? "Kijelölés törlése" : "Mindenki kijelölése"}
        </button>
      </fieldset>

      <Field
        label="Kezdőnap (hétfő)"
        htmlFor="start_date"
        hint={
          startIsMonday && lastItem
            ? `Az utolsó feladat napja: ${formatDayWithWeekday(scheduledDate(start, lastItem.week_no, lastItem.day_no))}.`
            : "A gyakorlási hét hétfőtől szombatig tart; a határidő a hét vasárnapja."
        }
      >
        <Input
          id="start_date"
          name="start_date"
          type="date"
          required
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-52"
        />
      </Field>
      {!startIsMonday && start ? <Notice tone="warning">A kezdőnap csak hétfő lehet.</Notice> : null}

      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? (
        <Notice tone="success">
          Kiosztva {state.studentCount} tanulónak.{" "}
          <Link href={`/tanar/kiosztasok/${state.assignmentId}`} className="font-bold underline">
            Ütemezés megtekintése és tanulónkénti módosítás
          </Link>
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending || selected.length === 0 || !startIsMonday || items.length === 0}>
        {pending ? "Kiosztás…" : `Kiosztás ${selected.length || ""} tanulónak`.replace("  ", " ")}
      </Button>
    </form>
  );
}
