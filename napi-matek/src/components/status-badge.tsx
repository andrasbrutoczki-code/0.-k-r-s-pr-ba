import { STUDENT_STATUS_LABEL, TEACHER_STATUS_LABEL, type TaskStatus } from "@/lib/tasks";

/**
 * Állapotjelző. A színek a felület jelentésrendszerét követik: kék tinta =
 * a tanulón a sor, piros toll = javítandó / tanári figyelmet kér, zöld = kész.
 * A szöveg mindig ki van írva, így a szín nem az egyetlen jelzés.
 */
const STYLES: Record<TaskStatus, string> = {
  not_started: "border-rule bg-sheet text-muted",
  submitted: "border-ink/40 bg-ink-soft text-ink",
  in_review: "border-ink/40 bg-ink-soft text-ink",
  feedback_given: "border-margin bg-redpen-soft text-graphite",
  accepted: "border-ok/50 bg-ok-soft text-ok",
  needs_revision: "border-redpen/50 bg-redpen-soft text-redpen",
};

export function StatusBadge({
  status,
  audience = "student",
  late = false,
}: {
  status: TaskStatus;
  audience?: "student" | "teacher";
  late?: boolean;
}) {
  const label = (audience === "teacher" ? TEACHER_STATUS_LABEL : STUDENT_STATUS_LABEL)[status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-bold ${STYLES[status]}`}>
        {label}
      </span>
      {late ? (
        <span className="inline-flex items-center rounded-full border border-margin px-2.5 py-0.5 text-sm text-graphite">
          késve beadva
        </span>
      ) : null}
    </span>
  );
}
