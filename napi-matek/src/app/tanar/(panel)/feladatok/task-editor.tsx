"use client";

import { useActionState, useEffect, useState } from "react";
import { saveTaskAction, type SaveTaskState } from "./actions";
import { MathText } from "@/components/math-text";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import type { Topic } from "@/lib/tasks";

export interface TaskEditorValues {
  id?: string;
  title: string;
  topic_id: number | null;
  difficulty: number;
  requires_image: boolean;
  body_md: string;
  solution_md: string;
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
  const [topicId, setTopicId] = useState(initial.topic_id ? String(initial.topic_id) : "");
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [requiresImage, setRequiresImage] = useState(initial.requires_image);
  const [body, setBody] = useState(initial.body_md);
  const [solution, setSolution] = useState(initial.solution_md);
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

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
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
        <Field label="Témakör" htmlFor="topic_id">
          <Select
            id="topic_id"
            name="topic_id"
            required
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
          >
            <option value="" disabled>
              Válassz…
            </option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
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
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="requires_image"
            checked={requiresImage}
            onChange={(e) => setRequiresImage(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-ink)]"
          />
          <span>
            <span className="font-bold">Kifejtős feladat</span>
            <span className="block text-sm text-muted">Csak fényképpel adható be.</span>
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
