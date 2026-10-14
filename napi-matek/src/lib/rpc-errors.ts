/**
 * Az adatbázis-függvények üzleti hibakódjai (raise exception '<kód>') →
 * érthető magyar üzenet. A PostgREST a kivétel szövegét `message`-ként adja vissza.
 */
const MESSAGES: Record<string, string> = {
  start_not_monday: "A kiosztás kezdőnapja csak hétfő lehet.",
  start_is_sunday: "Vasárnap szünnap, a kiosztás nem indulhat vasárnap.",
  start_missing: "Adj meg egy kezdőnapot.",
  task_in_use: "Ezt a feladatot a tanuló már elkezdte vagy beadta (vagy üzenetet írt hozzá), ezért nem törölhető.",
  assignment_not_found: "A kiosztás nem található (lehet, hogy már visszavontad).",
  task_not_found: "A feladat nem található.",
  no_students: "Válassz legalább egy tanulót.",
  empty_worksheet: "A munkalap üres. Előbb adj hozzá feladatot.",
  archived_task: "A munkalapon archivált feladat van. Cseréld le kiosztás előtt.",
  invalid_student: "A kiválasztott tanulók között letiltott vagy már nem létező is van.",
  task_archived: "Archivált feladat nem tehető munkalapra.",
  sunday_not_allowed: "Vasárnap szünnap, oda nem ütemezhető feladat.",
  due_before_date: "A határidő nem lehet korábbi a feladat napjánál.",
  not_reschedulable: "Ez a feladat már be van adva, ezért nem mozgatható.",
  not_swappable: "Csak még el nem kezdett, be nem adott feladat cserélhető.",
  task_not_available: "A választott feladat nem érhető el (archivált vagy törölt).",
  worksheet_not_found: "A munkalap nem található.",
  item_not_found: "A tétel nem található.",
};

export function describeRpcError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Ismeretlen hiba.";
  if (error.code === "42501") return "Ehhez a művelethez tanári jogosultság kell.";
  const key = Object.keys(MESSAGES).find((k) => error.message?.startsWith(k));
  return key ? MESSAGES[key]! : "A művelet nem sikerült. Próbáld újra.";
}
