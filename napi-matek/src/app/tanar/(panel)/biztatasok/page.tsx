import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTeacher } from "@/lib/auth/guards";
import { Button, Field, Input, Notice } from "@/components/ui";

export const metadata: Metadata = { title: "Biztató üzenetek" };

interface Encouragement {
  id: number;
  text: string;
  active: boolean;
}

const textSchema = z.string().trim().min(1).max(300);
const idSchema = z.coerce.number().int().positive();

async function addAction(formData: FormData) {
  "use server";
  const { supabase } = await requireTeacher();
  const text = textSchema.safeParse(formData.get("text"));
  if (!text.success) return;
  await supabase.from("encouragements").insert({ text: text.data });
  revalidatePath("/tanar/biztatasok");
}

async function toggleAction(formData: FormData) {
  "use server";
  const { supabase } = await requireTeacher();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("encouragements").update({ active: formData.get("active") === "true" }).eq("id", id.data);
  revalidatePath("/tanar/biztatasok");
}

async function updateAction(formData: FormData) {
  "use server";
  const { supabase } = await requireTeacher();
  const id = idSchema.safeParse(formData.get("id"));
  const text = textSchema.safeParse(formData.get("text"));
  if (!id.success || !text.success) return;
  await supabase.from("encouragements").update({ text: text.data }).eq("id", id.data);
  revalidatePath("/tanar/biztatasok");
}

async function deleteAction(formData: FormData) {
  "use server";
  const { supabase } = await requireTeacher();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await supabase.from("encouragements").delete().eq("id", id.data);
  revalidatePath("/tanar/biztatasok");
}

/**
 * A beadás után megjelenő biztató üzenetek. A rendszer az aktívak közül
 * véletlenszerűen választ; a kikapcsolt üzenet megmarad, csak nem jelenik meg.
 */
export default async function EncouragementsPage() {
  const { supabase } = await requireTeacher();
  const { data, error } = await supabase.from("encouragements").select("id, text, active").order("id");
  const items = (data ?? []) as Encouragement[];
  const activeCount = items.filter((i) => i.active).length;

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Biztató üzenetek</h1>
        <p className="max-w-prose text-muted">
          Amikor a tanuló beadja a feladatot, ezek közül kap egyet véletlenszerűen. Most {activeCount} aktív üzenet van.
        </p>
      </header>

      <section className="sheet" aria-label="Új üzenet">
        <form action={addAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Új üzenet" htmlFor="new-encouragement">
              <Input id="new-encouragement" name="text" required maxLength={300} />
            </Field>
          </div>
          <Button type="submit">Hozzáadás</Button>
        </form>
      </section>

      {error ? <Notice tone="error">Az üzenetek nem tölthetők be.</Notice> : null}
      {activeCount === 0 && items.length > 0 ? (
        <Notice tone="warning">Nincs aktív üzenet; a tanulók ilyenkor a „Szép munka!” szöveget kapják.</Notice>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-rule bg-sheet p-4">
            <form action={updateAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="hidden" name="id" value={item.id} />
              <label className="sr-only" htmlFor={`enc-${item.id}`}>
                Üzenet szövege
              </label>
              <Input
                id={`enc-${item.id}`}
                name="text"
                defaultValue={item.text}
                maxLength={300}
                className={item.active ? "" : "text-muted line-through"}
              />
              <Button type="submit" variant="secondary">
                Mentés
              </Button>
            </form>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={toggleAction}>
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="active" value={item.active ? "false" : "true"} />
                <Button type="submit" variant="quiet" className="px-0">
                  {item.active ? "Kikapcsolás" : "Bekapcsolás"}
                </Button>
              </form>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={item.id} />
                <Button type="submit" variant="quiet" className="px-0 text-redpen">
                  Törlés
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
