"use client";

import { useActionState, useState } from "react";
import {
  addStudentsAction,
  moveAssignmentAction,
  removeStudentTaskAction,
  revokeAssignmentAction,
  type EditResult,
  type RevokeResult,
} from "../actions";
import { Button, Field, Input, Notice } from "@/components/ui";

const idle: EditResult = { status: "idle" };
const revokeIdle: RevokeResult = { status: "idle" };

function ResultNotice({ result }: { result: EditResult }) {
  if (result.status === "idle") return null;
  return <Notice tone={result.status === "ok" ? "success" : "error"}>{result.message}</Notice>;
}

/** Az egész kiosztás áthelyezése új kezdőnapra (hibás kezdőnap javítása). */
export function MoveAssignmentForm({ assignmentId, startDate }: { assignmentId: string; startDate: string }) {
  const [result, action, pending] = useActionState(moveAssignmentAction, idle);
  const [value, setValue] = useState(startDate);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Új kezdőnap" htmlFor="move-start">
          <Input
            id="move-start"
            type="date"
            name="start_date"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-52"
          />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending || value === startDate} className="mb-0.5">
          {pending ? "Áthelyezés…" : "Kiosztás áthelyezése"}
        </Button>
      </div>
      <p className="text-sm text-muted">
        Minden még el nem kezdett feladat a munkalap ütemezése szerint új dátumot kap (a tanulónkénti egyedi
        áthelyezések is). A beadott feladatok maradnak.
      </p>
      <ResultNotice result={result} />
    </form>
  );
}

/** Kimaradt tanuló hozzáadása ugyanehhez a kiosztáshoz. */
export function AddStudentsForm({
  assignmentId,
  students,
}: {
  assignmentId: string;
  students: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState(addStudentsAction, idle);
  if (students.length === 0) return <p className="text-sm text-muted">Minden aktív tanuló szerepel a kiosztásban.</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <fieldset>
        <legend className="mb-1.5 font-bold">Tanuló hozzáadása</legend>
        <div className="flex flex-wrap gap-2">
          {students.map((s) => (
            <label
              key={s.id}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-rule bg-sheet px-3 has-[:checked]:border-ink has-[:checked]:bg-ink-soft"
            >
              <input type="checkbox" name="student_ids" value={s.id} className="h-5 w-5" />
              {s.name}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Hozzáadás…" : "Hozzáadás a kiosztáshoz"}
      </Button>
      <ResultNotice result={result} />
    </form>
  );
}

/**
 * Visszavonás – az egész kiosztásra vagy egy tanulóra. Oldalba épített
 * megerősítéssel. Csak az érintetlen feladatok törlődnek; ami már munka
 * (beadás, vázlat, üzenet), az megmarad, és ezt a válasz meg is mondja.
 */
export function RevokeForm({
  assignmentId,
  worksheetId,
  studentId,
  label,
}: {
  assignmentId: string;
  /** Csak dokumentációs célú: a szerver ide irányít teljes visszavonás után. */
  worksheetId: string;
  studentId?: string;
  label: string;
}) {
  const [result, action, pending] = useActionState(revokeAssignmentAction, revokeIdle);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-2">
      {confirming ? (
        <form action={action} className="space-y-2 rounded-md border-2 border-redpen/50 bg-redpen-soft p-3">
          <input type="hidden" name="assignment_id" value={assignmentId} />
          {studentId ? <input type="hidden" name="student_id" value={studentId} /> : null}
          <p className="text-sm">
            A még el nem kezdett feladatok törlődnek. Amit a tanuló már beadott, elkezdett vagy amihez üzenetet írt,
            megmarad.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Visszavonás…" : "Igen, visszavonom"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Mégse
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      {result.status === "error" ? <Notice tone="error">{result.message}</Notice> : null}
      {result.status === "done" && !result.assignmentDeleted ? (
        <Notice tone={result.kept ? "warning" : "success"}>
          {result.removed} feladat visszavonva.
          {result.kept ? ` ${result.kept} feladat megmaradt, mert már munka van benne.` : ""}
        </Notice>
      ) : null}
    </div>
  );
}

/** Egyetlen kiosztott feladat eltávolítása (csak ha érintetlen). */
export function RemoveTaskButton({ assignmentId, studentTaskId }: { assignmentId: string; studentTaskId: string }) {
  const [result, action, pending] = useActionState(removeStudentTaskAction, idle);
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="student_task_id" value={studentTaskId} />
      <Button type="submit" variant="quiet" className="min-h-10 px-0 text-redpen" disabled={pending}>
        {pending ? "…" : "Eltávolítás"}
      </Button>
      {result.status === "error" ? <span className="text-sm text-redpen">{result.message}</span> : null}
    </form>
  );
}
