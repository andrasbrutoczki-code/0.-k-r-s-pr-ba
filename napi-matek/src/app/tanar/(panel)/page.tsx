import { redirect } from "next/navigation";

/** Az áttekintő a 4. lépésben készül; addig a tanulókezelés a kezdőlap. */
export default function TeacherHome() {
  redirect("/tanar/tanulok");
}
