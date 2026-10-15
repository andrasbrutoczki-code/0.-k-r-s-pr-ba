import type { TaskType } from "./task-types";
import type { TaskLevel } from "./task-levels";

/**
 * Feladatbank: közös típusok és megjelenítési segédek.
 */

export interface Topic {
  id: number;
  slug: string;
  name: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  body_md: string;
  difficulty: number;
  requires_image: boolean;
  figure_path: string | null;
  archived_at: string | null;
  topic_id: number;
  task_type: TaskType;
  est_minutes: number | null;
  level: TaskLevel;
}

export type TaskStatus =
  | "not_started"
  | "submitted"
  | "in_review"
  | "feedback_given"
  | "accepted"
  | "needs_revision";

/** Állapotnevek a tanári nézetben („Beadva” helyett „Ellenőrzésre vár”). */
export const TEACHER_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Nincs elkezdve",
  submitted: "Ellenőrzésre vár",
  in_review: "Javítás alatt",
  feedback_given: "Visszajelzés elküldve",
  accepted: "Elfogadva",
  needs_revision: "Javítandó",
};

/** Állapotnevek a tanulói nézetben. */
export const STUDENT_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: "Nincs elkezdve",
  submitted: "Beadva",
  in_review: "Javítás alatt",
  feedback_given: "Visszajelzés érkezett",
  accepted: "Elfogadva",
  needs_revision: "Javítandó",
};
