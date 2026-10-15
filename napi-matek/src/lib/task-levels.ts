/** A feladat szintje: érettségi (alapértelmezett) vagy egyetemi. */
export type TaskLevel = "erettsegi" | "egyetem";

export const TASK_LEVELS: TaskLevel[] = ["erettsegi", "egyetem"];

export const TASK_LEVEL_LABEL: Record<TaskLevel, string> = {
  erettsegi: "Érettségi",
  egyetem: "Egyetem",
};

/** Beírt szint értelmezése (ékezet és kis-nagybetű nélkül); ismeretlenre null. */
export function parseTaskLevel(input: string): TaskLevel | null {
  const key = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  if (["erettsegi", "erettsegis", "kozepiskola", "emelt", "highschool"].includes(key)) return "erettsegi";
  if (["egyetem", "egyetemi", "university", "felsooktatas"].includes(key)) return "egyetem";
  return null;
}
