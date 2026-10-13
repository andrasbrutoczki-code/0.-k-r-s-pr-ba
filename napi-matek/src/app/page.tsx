import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";

/** A gyökér csak irányít: szerepkör szerint a megfelelő felületre. */
export default async function Home() {
  const session = await getSessionUser();
  if (session?.role === "teacher") redirect("/tanar");
  if (session?.role === "student") redirect("/tanulo");
  redirect("/belepes");
}
