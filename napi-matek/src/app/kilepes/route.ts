import { NextResponse, type NextRequest } from "next/server";
import { logoutCurrentUser } from "@/lib/auth/student-login";

/**
 * Kilépés. Route Handler, mert csak itt (és actionben) írhatók a sütik.
 *
 * GET: a tanulói őr ide irányít lejárt/visszavont munkamenetnél (?ok=lejart).
 *      Egy idegen oldalról indított GET legfeljebb kiléptetne – adatot nem ér
 *      el, ezért ez elfogadható.
 * POST: a „Kilépés” gomb (?ki=tanar a tanári felületről).
 */
async function handle(request: NextRequest) {
  await logoutCurrentUser();
  const params = request.nextUrl.searchParams;
  const target =
    params.get("ki") === "tanar"
      ? "/tanar/belepes"
      : `/belepes?ok=${params.get("ok") === "lejart" ? "lejart" : "kilepett"}`;
  // 303: POST után GET-tel töltse be a célt a böngésző.
  return NextResponse.redirect(new URL(target, request.url), { status: 303 });
}

export const GET = handle;
export const POST = handle;
