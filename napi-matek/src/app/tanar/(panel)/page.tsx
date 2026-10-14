import { redirect } from "next/navigation";

/** A tanári kezdőlap az ellenőrzés áttekintője. */
export default function TeacherHome() {
  redirect("/tanar/ellenorzes");
}
