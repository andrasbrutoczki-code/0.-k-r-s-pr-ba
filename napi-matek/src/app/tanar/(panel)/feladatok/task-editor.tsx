"use client";

import { useActionState, useEffect, useState } from "react";
import { saveTaskAction, type SaveTaskState } from "./actions";
import { MathText } from "@/components/math-text";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import type { Topic } from "@/lib/tasks";
import {
  TASK_TYPES,
  TASK_TYPE_LABEL,
  choiceLetters,
  defaultRequiresImage,
  estimateMinutes,
  type TaskType,
} from "@/lib/task-types";

export interface TaskEditorValues {
  id?: string;
  title: string;
  /** A feladat témakörei; az első az elsődleges. */
  topic_ids: number[];
  difficulty: number;
  requires_image: boolean;
  task_type: TaskType;
  est_minutes: number | null;
  body_md: string;
  solution_md: string;
  /** Tesztnél a helyes válasz betűje; "" = nincs megadva. */
  correct_choice: string;
}

const initialState: SaveTaskState = { status: "idle" };

/** Szövegmező élő KaTeX-előnézettel, egymás mellett (mobilon egymás alatt). */
function MathField({
  id,
  name,
  label,
  hint,
  value,
  onChange,
  rows,
  required,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  required?: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Field label={label} htmlFor={id} hint={hint}>
        <Textarea
          id={id}
          name={name}
          rows={rows}
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </Field>
      <div className="space-y-1.5">
        <p className="font-bold text-muted">Előnézet</p>
        <div className="min-h-24 rounded-md border border-dashed border-rule bg-sheet px-3 py-2">
          {value.trim() ? <MathText source={value} /> : <p className="text-muted">Itt jelenik meg a szöveg képletekkel.</p>}
        </div>
      </div>
    </div>
  );
}

export function TaskEditor({
  topics,
  initial,
  figureUrl,
  justSaved,
}: {
  topics: Topic[];
  initial: TaskEditorValues;
  figureUrl: string | null;
  justSaved: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveTaskAction, initialState);
  // Minden mező vezérelt: a React 19 a beküldés után alaphelyzetbe állítja az
  // űrlapot, így hibánál sem vész el, amit a tanár beírt.
  const [title, setTitle] = useState(initial.title);
  const [topicIds, setTopicIds] = useState<number[]>(initial.topic_ids);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [requiresImage, setRequiresImage] = useState(initial.requires_image);
  const [taskType, setTaskType] = useState<TaskType>(initial.task_type);
  const [minutes, setMinutes] = useState(initial.est_minutes ? String(initial.est_minutes) : "");
  const [body, setBody] = useState(initial.body_md);
  const [solution, setSolution] = useState(initial.solution_md);
  const [correct, setCorrect] = useState(initial.correct_choice);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeFigure, setRemoveFigure] = useState(false);

  // A kiválasztott (még nem mentett) ábra előnézete; az objektum-URL-t felszabadítjuk.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  // Beküldés után a fájlmező kiürül, ezért a helyi előnézetet is eldobjuk.
  useEffect(() => {
    setPreview(null);
    setRemoveFigure(false);
  }, [state]);

  const shownFigure = preview ?? (removeFigure ? null : figureUrl);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <Field label="Cím" htmlFor="title">
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <fieldset>
        <legend className="mb-1.5 font-bold">
          Témakörök <span className="font-normal text-muted">(egy vagy több; az első bejelölt az elsődleges)</span>
        </legend>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((t) => (
            <label
              key={t.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink-soft"
            >
              <input
                type="checkbox"
                name="topic_ids"
                value={t.id}
                checked={topicIds.includes(t.id)}
                onChange={() =>
                  setTopicIds((ids) => (ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id]))
                }
                className="h-4 w-4 shrink-0"
              />
              {t.name}
              {topicIds[0] === t.id && topicIds.length > 1 ? (
                <span className="ml-auto text-xs text-muted">elsődleges</span>
              ) : null}
            </label>
          ))}
        </div>
        {/* A bejelölés sorrendje számít (az első az elsődleges), ezért külön küldjük. */}
        <input type="hidden" name="topic_order" value={topicIds.join(",")} />
      </fieldset>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <fieldset>
          <legend className="mb-1.5 font-bold">Típus</legend>
          <div className="flex gap-1">
            {TASK_TYPES.map((type) => (
              <label
                key={type}
                className="flex h-12 cursor-pointer items-center rounded-md border border-rule bg-sheet px-3 font-bold has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="task_type"
                  value={type}
                  checked={taskType === type}
                  onChange={() => {
                    setTaskType(type);
                    // A típus váltása a beadás módját is beállítja (felülírható).
                    setRequiresImage(defaultRequiresImage(type));
                  }}
                  className="sr-only"
                />
                {TASK_TYPE_LABEL[type]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 font-bold">Nehézség</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border border-rule bg-sheet font-bold has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="difficulty"
                  value={n}
                  checked={difficulty === n}
                  onChange={() => setDifficulty(n)}
                  className="sr-only"
                />
                {n}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="space-y-1.5">
          <span className="block font-bold">Becsült idő (perc)</span>
          <input
            name="est_minutes"
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            value={minutes}
            placeholder={String(estimateMinutes(taskType, difficulty))}
            onChange={(e) => setMinutes(e.target.value)}
            className="block min-h-12 w-28 rounded-md border border-rule bg-sheet px-3"
          />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="requires_image"
            checked={requiresImage}
            onChange={(e) => setRequiresImage(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-ink)]"
          />
          <span>
            <span className="font-bold">Fénykép kell a beadáshoz</span>
            <span className="block text-sm text-muted">
              {taskType === "teszt" ? "Tesztnél a tanuló szöveges indoklást ír." : "Kifejtős feladatnál alapból bekapcsolva."}
            </span>
          </span>
        </label>
      </div>

      <MathField
        id="body_md"
        name="body_md"
        label="Feladat szövege"
        hint="Képlet: $x^2$ a szövegben, $$…$$ külön sorban. Dollárjel: \$."
        value={body}
        onChange={setBody}
        rows={10}
        required
      />

      <div className="space-y-2">
        <p className="font-bold">Ábra (PNG, legfeljebb 5 MB)</p>
        {shownFigure ? (
          // eslint-disable-next-line @next/next/no-img-element -- aláírt, lejáró URL; a next/image optimalizálója nem érné el
          <img src={shownFigure} alt="A feladat ábrája" className="max-h-72 rounded-md border border-rule bg-white" />
        ) : null}
        <input
          type="file"
          name="figure"
          accept="image/png"
          className="block text-sm file:mr-3 file:min-h-12 file:rounded-md file:border file:border-ink/40 file:bg-sheet file:px-4 file:font-bold file:text-ink"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
        />
        {figureUrl && !preview ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="remove_figure"
              checked={removeFigure}
              onChange={(e) => setRemoveFigure(e.target.checked)}
            />
            Ábra eltávolítása
          </label>
        ) : null}
      </div>

      {taskType === "teszt" ? (
        <fieldset>
          <legend className="mb-1.5 font-bold">Helyes válasz (csak te látod)</legend>
          <div className="flex flex-wrap gap-1">
            {[...new Set([...choiceLetters(body), ...(correct ? [correct] : [])])].sort().map((letter) => (
              <label
                key={letter}
                className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border border-rule bg-sheet text-lg font-bold has-[:checked]:border-ok has-[:checked]:bg-ok has-[:checked]:text-white"
              >
                <input
                  type="radio"
                  name="correct_choice"
                  value={letter}
                  checked={correct === letter}
                  onChange={() => setCorrect(letter)}
                  className="sr-only"
                />
                {letter}
              </label>
            ))}
            <label className="flex h-12 cursor-pointer items-center rounded-md border border-rule bg-sheet px-3 text-sm has-[:checked]:border-ink has-[:checked]:bg-ink-soft">
              <input
                type="radio"
                name="correct_choice"
                value=""
                checked={correct === ""}
                onChange={() => setCorrect("")}
                className="sr-only"
              />
              Nincs megadva
            </label>
          </div>
          <p className="mt-1 text-sm text-muted">
            Ebből jelzi a rendszer az ellenőrzésnél, hogy a tanuló jól választott-e. A betűk a szöveg (A), (B)…
            jelöléseiből jönnek.
          </p>
        </fieldset>
      ) : null}

      <MathField
        id="solution_md"
        name="solution_md"
        label="Megoldási útmutató (csak te látod)"
        hint="Nem kötelező. A tanulók soha nem kapják meg."
        value={solution}
        onChange={setSolution}
        rows={6}
      />

      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      {state.status === "saved" || (justSaved && state.status === "idle") ? (
        <Notice tone="success">Feladat mentve.</Notice>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Mentés…" : initial.id ? "Változások mentése" : "Feladat létrehozása"}
      </Button>
    </form>
  );
}
