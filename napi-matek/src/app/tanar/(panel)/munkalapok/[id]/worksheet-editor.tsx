"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  addItemAction,
  applyWeekAction,
  assignWorksheetAction,
  previewWeekAction,
  duplicateWorksheetAction,
  moveItemAction,
  removeItemAction,
  removeItemsAction,
  updateItemSlotAction,
  updateWorksheetAction,
  type ActionResult,
  type AssignResult,
} from "../actions";
import { Button, Difficulty, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { PRACTICE_DAYS, formatDayWithWeekday, isoWeekday, scheduledDate } from "@/lib/schedule";
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from "@/lib/task-types";
import { TASK_LEVELS, TASK_LEVEL_LABEL, type TaskLevel } from "@/lib/task-levels";
import type { WeekPlan } from "@/lib/week-generator";
import { TaskPreview } from "./task-preview";

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
  topicIds: number[];
  type: TaskType;
  level: TaskLevel;
  minutes: number;
}

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1);

/** A feladatválasztó egyszerre ennyit mutat (több száz feladatnál is gyors marad). */
const PICKER_PAGE = 40;

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
  // Kijelölés a több tétel egyszerre törléséhez (megerősítéssel).
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const live = selected.filter((id) => items.some((i) => i.id === id));

  if (items.length === 0) {
    return <p className="text-muted">A munkalap még üres. Adj hozzá feladatokat a feladatbankból (lent).</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-rule bg-paper px-3 py-2 text-sm">
        <label className="flex min-h-10 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={live.length === items.length}
            onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
          />
          Mind kijelölése
        </label>
        <span className="text-muted">{live.length} kijelölve</span>
        {live.length > 0 && !confirming ? (
          <Button type="button" variant="danger" className="min-h-10 px-3" onClick={() => setConfirming(true)}>
            Kijelöltek törlése a munkalapról
          </Button>
        ) : null}
        {confirming && live.length > 0 ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-redpen">{live.length} feladat kikerül a munkalapról. A már kiosztott feladatok megmaradnak.</span>
            <Button
              type="button"
              variant="danger"
              className="min-h-10 px-3"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await removeItemsAction(worksheetId, live);
                  if (r.ok) {
                    setSelected([]);
                    setConfirming(false);
                  }
                  return r;
                })
              }
            >
              Igen, törlöm
            </Button>
            <Button type="button" variant="secondary" className="min-h-10 px-3" onClick={() => setConfirming(false)}>
              Mégse
            </Button>
          </span>
        ) : null}
      </div>
      <ol className={`space-y-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
        {items.map((item, index) => (
          <li key={item.id} className="rounded-md border border-rule bg-sheet p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="flex items-start gap-2 font-bold">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5 shrink-0"
                  aria-label={`${item.task.title}: kijelölés`}
                  checked={live.includes(item.id)}
                  onChange={() =>
                    setSelected((ids) => (ids.includes(item.id) ? ids.filter((x) => x !== item.id) : [...ids, item.id]))
                  }
                />
                <span className="text-muted">{index + 1}.</span>
                {item.task.title}
                {item.task.archived ? <span className="ml-2 text-sm text-redpen">(archivált)</span> : null}
              </p>
              <span className="flex items-center gap-2 text-sm text-muted">
                {item.task.topicName} <Difficulty value={item.task.difficulty} />
              </span>
            </div>
            <TaskPreview taskId={item.task.id} />
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
                    </option>
                  ))}
                  {item.day_no === 6 ? (
                    <option value={6} disabled>
                      szombat (pótlónap, válassz másik napot)
                    </option>
                  ) : null}
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
                  Törlés
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
  const [type, setType] = useState("");
  const [level, setLevel] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [limit, setLimit] = useState(PICKER_PAGE);
  const used = useMemo(() => new Set(usedTaskIds), [usedTaskIds]);
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  const filtered = tasks.filter(
    (t) =>
      (!topicId || t.topicIds.includes(Number(topicId))) &&
      (!type || t.type === type) &&
      (!level || t.level === level) &&
      (!difficulty || String(t.difficulty) === difficulty) &&
      (!query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const visible = filtered.slice(0, limit);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
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
        <Field label="Típus" htmlFor="picker-type">
          <Select id="picker-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Mind</option>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Szint" htmlFor="picker-level">
          <Select id="picker-level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Mind</option>
            {TASK_LEVELS.map((l) => (
              <option key={l} value={l}>
                {TASK_LEVEL_LABEL[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nehézség" htmlFor="picker-diff">
          <Select id="picker-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Mind</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm text-muted">{filtered.length} találat</p>
      {filtered.length === 0 ? <p className="text-muted">Nincs a keresésnek megfelelő feladat.</p> : null}
      <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
        {visible.map((task) => (
          <li key={task.id} className="rounded-md border border-rule bg-sheet px-3 py-1">
            <div className="flex items-center justify-between gap-3">
            <span>
              <span className="font-bold">{task.title}</span>
              <span className="ml-2 text-sm text-muted">
                {task.topicIds.map((id) => topicName.get(id)).filter(Boolean).join(", ")}, {TASK_TYPE_LABEL[task.type].toLowerCase()}, ~{task.minutes} perc
              </span>
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
            </div>
            <TaskPreview taskId={task.id} />
          </li>
        ))}
      </ul>
      {filtered.length > visible.length ? (
        <Button type="button" variant="quiet" onClick={() => setLimit(limit + PICKER_PAGE)}>
          További {Math.min(PICKER_PAGE, filtered.length - visible.length)} megjelenítése
        </Button>
      ) : null}
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

  const startValid = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const startIsMonday = startValid && isoWeekday(start) === 1;
  const startIsWeekend = startValid && isoWeekday(start) >= 6;
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
        label="Kezdőnap"
        htmlFor="start_date"
        hint={
          startValid && lastItem
            ? `Első feladat: ${formatDayWithWeekday(scheduledDate(start, 1, 1))}, utolsó: ${formatDayWithWeekday(
                scheduledDate(start, lastItem.week_no, lastItem.day_no),
              )}. A határidő mindig az adott hét vasárnapja, a szombat pótlónap.${
                startIsMonday ? "" : " Nem hétfői kezdésnél a feladatok tanítási napokban tolódnak (a hétvége kimarad)."
              }${startIsWeekend ? " Hétvégi kezdőnapnál az első feladat a következő hétfő." : ""}`
            : "Bármely nap lehet. Feladat csak hétfőtől péntekig kerül ki; a szombat pótlónap."
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

      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "done" ? (
        <Notice tone="success">
          Kiosztva {state.studentCount} tanulónak.{" "}
          <Link href={`/tanar/kiosztasok/${state.assignmentId}`} className="font-bold underline">
            Ütemezés megtekintése és tanulónkénti módosítás
          </Link>
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending || selected.length === 0 || !startValid || items.length === 0}>
        {pending ? "Kiosztás…" : `Kiosztás ${selected.length || ""} tanulónak`.replace("  ", " ")}
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Hétgenerátor
// -----------------------------------------------------------------------------

/**
 * Javaslat egy teljes hétre (hétfő–péntek) témakör, nehézség,
 * típus és napi időkeret alapján. Előbb előnézet, újrakérhető („Új javaslat”),
 * és csak jóváhagyás után kerül a munkalapra.
 */
export function WeekGenerator({
  worksheetId,
  topics,
  defaultWeek,
}: {
  worksheetId: string;
  topics: { id: number; name: string; count: number }[];
  defaultWeek: number;
}) {
  const [topicIds, setTopicIds] = useState<number[]>([]);
  const [types, setTypes] = useState<TaskType[]>(["teszt", "kifejtos"]);
  const [levels, setLevels] = useState<TaskLevel[]>(["erettsegi"]);
  const [range, setRange] = useState({ min: 1, max: 3 });
  const [minutesPerDay, setMinutesPerDay] = useState(30);
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [weekNo, setWeekNo] = useState(defaultWeek);
  const [plan, setPlan] = useState<{ plan: WeekPlan; poolSize: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  function generate() {
    startTransition(async () => {
      setMessage(null);
      const result = await previewWeekAction({
        worksheetId,
        topicIds,
        types,
        levels,
        difficultyMin: range.min,
        difficultyMax: range.max,
        minutesPerDay,
        onlyUnassigned,
        seed: Math.floor(Math.random() * 2 ** 31),
      });
      if (result.ok) setPlan({ plan: result.plan, poolSize: result.poolSize });
      else {
        setPlan(null);
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  function apply() {
    if (!plan) return;
    const items = plan.plan.days.flatMap((d) => d.tasks.map((t) => ({ taskId: t.taskId, dayNo: d.dayNo })));
    startTransition(async () => {
      const result = await applyWeekAction(worksheetId, weekNo, items);
      if (result.ok) {
        setPlan(null);
        setWeekNo(weekNo + 1);
        setMessage({ tone: "success", text: `${items.length} feladat felkerült a munkalapra (${weekNo}. hét).` });
      } else {
        setMessage({ tone: "error", text: result.message });
      }
    });
  }

  const totalTasks = plan?.plan.days.reduce((s, d) => s + d.tasks.length, 0) ?? 0;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="font-bold">Témakörök</legend>
        <div className="flex flex-wrap gap-2">
          {topics.map((t) => (
            <label
              key={t.id}
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md border px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft ${
                t.count === 0 ? "border-rule text-muted" : "border-rule bg-sheet"
              }`}
            >
              <input
                type="checkbox"
                checked={topicIds.includes(t.id)}
                onChange={() => setTopicIds(toggle(topicIds, t.id))}
                className="h-5 w-5"
              />
              {t.name}
              <span className="text-sm text-muted">({t.count})</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <fieldset>
          <legend className="mb-1.5 font-bold">Típusok</legend>
          <div className="flex gap-2">
            {TASK_TYPES.map((t) => (
              <label
                key={t}
                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft"
              >
                <input type="checkbox" checked={types.includes(t)} onChange={() => setTypes(toggle(types, t))} className="h-5 w-5" />
                {TASK_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 font-bold">Szint</legend>
          <div className="flex gap-2">
            {TASK_LEVELS.map((l) => (
              <label
                key={l}
                className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft"
              >
                <input type="checkbox" checked={levels.includes(l)} onChange={() => setLevels(toggle(levels, l))} className="h-5 w-5" />
                {TASK_LEVEL_LABEL[l]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 font-bold">Nehézség</legend>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Legkisebb nehézség"
              value={range.min}
              onChange={(e) => {
                const min = Number(e.target.value);
                setRange({ min, max: Math.max(min, range.max) });
              }}
              className="w-20"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <span aria-hidden="true">–</span>
            <Select
              aria-label="Legnagyobb nehézség"
              value={range.max}
              onChange={(e) => {
                const max = Number(e.target.value);
                setRange({ min: Math.min(range.min, max), max });
              }}
              className="w-20"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <label className="space-y-1.5">
          <span className="block font-bold">Napi időkeret (perc)</span>
          <Input
            type="number"
            min={5}
            max={120}
            value={minutesPerDay}
            onChange={(e) => setMinutesPerDay(Number(e.target.value) || 30)}
            className="w-28"
          />
        </label>

        <label className="space-y-1.5">
          <span className="block font-bold">Melyik hétre</span>
          <Select value={weekNo} onChange={(e) => setWeekNo(Number(e.target.value))} className="w-24">
            {WEEKS.map((w) => (
              <option key={w} value={w}>
                {w}.
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} className="h-5 w-5" />
          Csak még ki nem osztott feladatok
        </label>
      </div>

      <Button type="button" onClick={generate} disabled={pending || topicIds.length === 0 || types.length === 0 || levels.length === 0}>
        {pending && !plan ? "Javaslat készül…" : plan ? "Új javaslat" : "Javaslat készítése"}
      </Button>
      {topicIds.length === 0 ? <p className="text-sm text-muted">Válassz legalább egy témakört.</p> : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {plan ? (
        <div className="space-y-3">
          {plan.plan.warnings.map((w) => (
            <Notice key={w} tone="warning">
              {w}
            </Notice>
          ))}
          <p className="text-sm text-muted">
            {plan.poolSize} feladat felelt meg a feltételeknek; a javaslat {totalTasks} feladat.
          </p>
          <ol className="grid gap-3 md:grid-cols-2">
            {plan.plan.days.map((day) => (
              <li key={day.dayNo} className="rounded-md border border-rule bg-sheet p-3">
                <p className="flex justify-between font-bold">
                  <span>
                    {PRACTICE_DAYS[day.dayNo - 1]}
                  </span>
                  <span className={day.minutes > minutesPerDay + 5 || day.minutes < minutesPerDay * 0.7 ? "text-redpen" : "text-muted"}>
                    ~{day.minutes} perc
                  </span>
                </p>
                {day.tasks.length === 0 ? <p className="text-sm text-muted">Nincs feladat.</p> : null}
                <ul className="mt-1 space-y-1 text-sm">
                  {day.tasks.map((t) => (
                    <li key={t.taskId} className="flex justify-between gap-2">
                      <div className="min-w-0">
                        {t.title}
                        <span className="ml-1 text-muted">
                          ({t.topicIds.map((id) => topicName.get(id)).filter(Boolean).join(", ")}, {TASK_TYPE_LABEL[t.type].toLowerCase()})
                        </span>
                        <TaskPreview taskId={t.taskId} />
                      </div>
                      <span className="flex shrink-0 items-center gap-2 text-muted">
                        <Difficulty value={t.difficulty} /> {t.minutes}′
                        <button
                          type="button"
                          className="min-h-8 px-1 font-bold text-redpen"
                          aria-label={`${t.title}: kivétel a javaslatból`}
                          title="Kivétel a javaslatból"
                          onClick={() =>
                            setPlan((p) =>
                              p
                                ? {
                                    ...p,
                                    plan: {
                                      ...p.plan,
                                      days: p.plan.days.map((d) =>
                                        d.dayNo !== day.dayNo
                                          ? d
                                          : (() => {
                                              const tasks = d.tasks.filter((x) => x.taskId !== t.taskId);
                                              return { ...d, tasks, minutes: tasks.reduce((m, x) => m + x.minutes, 0) };
                                            })(),
                                      ),
                                    },
                                  }
                                : p,
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <Button type="button" onClick={apply} disabled={pending || totalTasks === 0}>
            {pending ? "Mentés…" : `Hozzáadás a munkalaphoz (${weekNo}. hét)`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
