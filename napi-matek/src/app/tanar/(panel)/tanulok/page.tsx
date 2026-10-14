import type { Metadata } from "next";
import { requireTeacher } from "@/lib/auth/guards";
import { daysUntil, formatDate } from "@/lib/dates";
import { Notice } from "@/components/ui";
import { setAiConsentAction } from "./actions";
import { CreateStudentForm, DeleteStudentForm, DisableForm, RegenerateCodeForm } from "./student-admin";

export const metadata: Metadata = { title: "Tanulók" };

interface StudentRow {
  id: string;
  display_name: string;
  disabled_at: string | null;
  ai_consent: boolean;
  created_at: string;
  student_sessions: { session_id: string; expires_at: string; revoked_at: string | null }[];
}

/** Egy tanuló belépési állapota a tanár számára, egy mondatban. */
function describeAccess(student: StudentRow, now: Date): { text: string; warn: boolean } {
  if (student.disabled_at) {
    return { text: "Letiltva: nem tud belépni. Visszaengedélyezheted vagy véglegesen törölheted.", warn: true };
  }

  const active = student.student_sessions
    .filter((s) => !s.revoked_at && new Date(s.expires_at) > now)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));

  if (active.length === 0) return { text: "Még nem lépett be, vagy kilépett", warn: false };

  const soonest = new Date(active[0]!.expires_at);
  const left = daysUntil(soonest, now);
  const devices = active.length === 1 ? "1 eszközön" : `${active.length} eszközön`;
  return left < 7
    ? { text: `Belépve ${devices}, ${left} nap múlva lejár`, warn: true }
    : { text: `Belépve ${devices}, lejár: ${formatDate(soonest)}`, warn: false };
}

export default async function StudentsPage() {
  const { supabase } = await requireTeacher();

  const { data, error } = await supabase
    .from("students")
    .select("id, display_name, disabled_at, ai_consent, created_at, student_sessions(session_id, expires_at, revoked_at)")
    .order("display_name");
  const students = (data ?? []) as StudentRow[];
  const now = new Date();

  return (
    <main className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold">Tanulók</h1>
        <p className="text-muted">
          A tanulóknak nincs e-mail-címük: a nevükkel és egy 8 karakteres belépőkóddal lépnek be,
          és egy évig bejelentkezve maradnak a saját eszközükön.
        </p>
      </header>

      <section className="sheet" aria-label="Új tanuló felvétele">
        <CreateStudentForm />
      </section>

      {error ? <Notice tone="error">A tanulók listája nem tölthető be.</Notice> : null}

      {students.length === 0 && !error ? (
        <p className="text-muted">Még nincs tanulód. Vedd fel az elsőt a fenti mezővel.</p>
      ) : (
        <ul className="space-y-3" aria-label="Tanulók listája">
          {students.map((student) => {
            const access = describeAccess(student, now);
            return (
              <li
                key={student.id}
                className="flex flex-col gap-4 rounded-md border border-rule bg-sheet p-4 md:flex-row md:items-start md:justify-between"
              >
                <div className="space-y-1">
                  <p className={`text-lg font-bold ${student.disabled_at ? "text-muted line-through" : ""}`}>
                    {student.display_name}
                  </p>
                  <p className={access.warn ? "text-redpen" : "text-muted"}>{access.text}</p>
                  <p className="text-sm text-muted">Felvéve: {formatDate(student.created_at)}</p>
                  <form action={setAiConsentAction} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="hidden" name="studentId" value={student.id} />
                    <input type="hidden" name="consent" value={student.ai_consent ? "false" : "true"} />
                    <span className={student.ai_consent ? "text-ok" : "text-muted"}>
                      AI-asszisztens: {student.ai_consent ? "szülői hozzájárulás megvan" : "nincs hozzájárulás"}
                    </span>
                    <button className="min-h-10 font-bold text-ink underline-offset-4 hover:underline">
                      {student.ai_consent ? "Visszavonás" : "Hozzájárulás rögzítése"}
                    </button>
                  </form>
                </div>
                <div className="flex flex-wrap items-start gap-3 md:max-w-md md:justify-end">
                  <RegenerateCodeForm studentId={student.id} studentName={student.display_name} />
                  <DisableForm
                    studentId={student.id}
                    studentName={student.display_name}
                    disabled={Boolean(student.disabled_at)}
                  />
                  {student.disabled_at ? (
                    <DeleteStudentForm studentId={student.id} studentName={student.display_name} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
