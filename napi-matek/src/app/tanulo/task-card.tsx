import { MathText } from "@/components/math-text";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { formatDayWithWeekday } from "@/lib/schedule";
import { TASK_TYPE_LABEL } from "@/lib/task-types";
import type { SubmissionVersion, TaskDetail } from "@/lib/student/tasks";
import { MessageThread } from "./message-thread";
import { SubmissionPanel } from "./submission-panel";

/** Egy beadott verzió tartalma (betűjel, szöveg, képek). */
function VersionView({ version }: { version: SubmissionVersion }) {
  return (
    <div className="space-y-2">
      {version.choice ? (
        <p>
          Választott válasz: <strong className="text-lg">{version.choice}</strong>
        </p>
      ) : null}
      {version.answerText ? <p className="whitespace-pre-line rounded-md bg-paper p-2">{version.answerText}</p> : null}
      {version.images.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {version.images.map((image, index) =>
            image.url ? (
              <li key={image.id}>
                <a href={image.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL */}
                  <img
                    src={image.url}
                    alt={`${index + 1}. beadott fénykép`}
                    className="aspect-[3/4] w-full rounded-md border border-rule object-cover"
                  />
                </a>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Egy feladat teljes nézete a tanulónak: szöveg képletekkel, ábra, beadás,
 * korábbi verziók és üzenetszál. A „Mai feladat” blokkban és a feladatoldalon is ez jelenik meg.
 */
export function TaskCard({ task, studentId, headingLevel = 2 }: { task: TaskDetail; studentId: string; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const latest = task.versions[0];

  return (
    <article className="sheet space-y-4" aria-labelledby={`task-${task.id}`}>
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading id={`task-${task.id}`} className="text-xl font-bold">
            {task.title}
          </Heading>
          <StatusBadge status={task.status} late={task.isLate} />
        </div>
        <p className="text-sm text-muted">
          {task.topicName}, {TASK_TYPE_LABEL[task.type].toLowerCase()}, kb. {task.minutes} perc, határidő:{" "}
          {formatDayWithWeekday(task.dueDate)}
        </p>
      </header>

      <MathText source={task.body} className="text-[1.0625rem]" />

      {task.figureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- lejáró aláírt URL
        <img src={task.figureUrl} alt={`Ábra: ${task.title}`} className="max-h-96 rounded-md border border-rule bg-white" />
      ) : null}

      {!task.editable && latest ? (
        <section className="space-y-2 border-t border-rule pt-4" aria-label="A beadásod">
          <h3 className="font-bold">
            A beadásod{latest.submittedAt ? `, ${formatDateTime(latest.submittedAt)}` : ""}
          </h3>
          <VersionView version={latest} />
        </section>
      ) : null}

      <SubmissionPanel
        studentId={studentId}
        studentTaskId={task.id}
        type={task.type}
        requiresImage={task.requiresImage}
        letters={task.letters}
        editable={task.editable}
        isRevision={task.status === "needs_revision"}
        draft={task.draft ? { id: task.draft.id, images: task.draft.images } : null}
      />

      {task.versions.length > (task.editable ? 0 : 1) ? (
        <details className="border-t border-rule pt-4">
          <summary className="cursor-pointer font-bold text-ink">Korábbi beadások</summary>
          <ol className="mt-3 space-y-4">
            {task.versions.slice(task.editable ? 0 : 1).map((v) => (
              <li key={v.id} className="space-y-1">
                <p className="text-sm text-muted">
                  {v.version}. változat{v.submittedAt ? `, ${formatDateTime(v.submittedAt)}` : ""}
                </p>
                <VersionView version={v} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <MessageThread studentTaskId={task.id} messages={task.messages} />
    </article>
  );
}
