"use client";

import { useActionState, useState } from "react";
import { rescheduleAction, swapTaskAction, type EditResult } from "../actions";
import { Button, Notice, Select } from "@/components/ui";

const initial: EditResult = { status: "idle" };

/**
 * Egy kiosztott feladat tanulónkénti módosítása: áthelyezés másik napra és
 * (beadás előtt) csere másik feladatra. Csukott állapotban csak egy gomb,
 * hogy a táblázat áttekinthető maradjon.
 */
export function StudentTaskEdit({
  assignmentId,
  studentTaskId,
  date,
  dueDate,
  canSwap,
  tasks,
}: {
  assignmentId: string;
  studentTaskId: string;
  date: string;
  dueDate: string;
  canSwap: boolean;
  tasks: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [moveState, moveAction, movePending] = useActionState(rescheduleAction, initial);
  const [swapState, swapAction, swapPending] = useActionState(swapTaskAction, initial);
  // A határidő alapból üres: ilyenkor az adatbázis az új nap hetének vasárnapját
  // állítja be, így egy másik hétre mozgatott feladat határideje is helyes lesz.
  const [values, setValues] = useState({ date, due: "", task: "" });

  if (!open) {
    return (
      <Button type="button" variant="quiet" className="min-h-10 px-0" onClick={() => setOpen(true)}>
        Módosítás
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-rule bg-paper p-3">
      <form action={moveAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <input type="hidden" name="student_task_id" value={studentTaskId} />
        <label className="text-sm">
          <span className="block font-bold">Új nap</span>
          <input
            type="date"
            name="date"
            required
            value={values.date}
            onChange={(e) => setValues({ ...values, date: e.target.value })}
            className="min-h-12 rounded-md border border-rule bg-sheet px-2"
          />
        </label>
        <label className="text-sm">
          <span className="block font-bold">Új határidő (nem kötelező)</span>
          <input
            type="date"
            name="due_date"
            value={values.due}
            onChange={(e) => setValues({ ...values, due: e.target.value })}
            className="min-h-12 rounded-md border border-rule bg-sheet px-2"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={movePending}>
          {movePending ? "…" : "Áthelyezés"}
        </Button>
      </form>
      <p className="text-xs text-muted">
        Jelenlegi határidő: {dueDate}. Ha üresen hagyod, az új nap hetének vasárnapja lesz.
      </p>
      {moveState.status !== "idle" ? (
        <Notice tone={moveState.status === "ok" ? "success" : "error"}>{moveState.message}</Notice>
      ) : null}

      {canSwap ? (
        <form action={swapAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="assignment_id" value={assignmentId} />
          <input type="hidden" name="student_task_id" value={studentTaskId} />
          <label className="min-w-56 flex-1 text-sm">
            <span className="block font-bold">Csere erre a feladatra</span>
            <Select
              name="task_id"
              required
              value={values.task}
              onChange={(e) => setValues({ ...values, task: e.target.value })}
            >
              <option value="" disabled>
                Válassz…
              </option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="secondary" disabled={swapPending || !values.task}>
            {swapPending ? "…" : "Csere"}
          </Button>
        </form>
      ) : null}
      {swapState.status !== "idle" ? (
        <Notice tone={swapState.status === "ok" ? "success" : "error"}>{swapState.message}</Notice>
      ) : null}

      <Button type="button" variant="quiet" className="min-h-10 px-0" onClick={() => setOpen(false)}>
        Bezárás
      </Button>
    </div>
  );
}
