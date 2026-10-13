import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Egyetlen feladat: a Supabase munkamenet frissítése (lejárt access token
 * cseréje a refresh tokennel) és a friss sütik visszaírása.
 *
 * Szándékosan NEM itt döntünk a jogosultságról. A middleware megkerülhető
 * volt már (CVE-2025-29927), ezért a védelem rétegei:
 *   1. layoutok és server actionök: requireTeacher() / requireStudent(),
 *   2. adatbázis: RLS + current_student_id() minden lekérdezésnél.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // A getUser() az Auth szerverrel ellenőrzi a tokent, és szükség esetén frissít.
  // A createServerClient és a getUser között nem szabad más logikát futtatni.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Statikus fájlokra és képekre nincs szükség munkamenet-frissítésre.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
