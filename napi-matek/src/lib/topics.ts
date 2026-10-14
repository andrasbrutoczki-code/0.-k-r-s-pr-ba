import type { createClient } from "@/lib/supabase/server";
import type { Topic } from "@/lib/tasks";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Az aktív témakörök a tanár által megadott sorrendben. A visszavont (régi,
 * összevont) témakörök nem választhatók, de a régi adatok hivatkozhatnak rájuk.
 */
export async function loadTopics(supabase: Supabase): Promise<Topic[]> {
  const { data } = await supabase.from("topics").select("id, slug, name").eq("retired", false).order("sort_order");
  return (data ?? []) as Topic[];
}

/** Egy feladat témakörazonosítói a task_topics beágyazásból, a témakörlista sorrendjében. */
export function topicIdsOf(
  rows: { topic_id: number }[] | null | undefined,
  order: Topic[],
): number[] {
  const ids = new Set((rows ?? []).map((r) => r.topic_id));
  return order.filter((t) => ids.has(t.id)).map((t) => t.id);
}

/** Témakörnevek vesszővel – ismeretlen (visszavont) azonosítók nélkül. */
export function topicNames(ids: number[], byId: Map<number, string>): string {
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .join(", ");
}
