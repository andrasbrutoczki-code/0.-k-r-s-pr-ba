/**
 * Környezeti változók típusos, lusta olvasása.
 *
 * Lusta (függvényhívásos) olvasás: a `next build` importálja a modulokat, és
 * ha itt modulszinten dobnánk hibát, a build hiányzó env mellett is elbukna.
 * A NEXT_PUBLIC_ változókat a Next.js csak szó szerinti hivatkozásnál inline-olja,
 * ezért azokat itt egyenként, literálisan érjük el.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Hiányzó környezeti változó: ${name}. Lásd: .env.example`);
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabasePublishableKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** Csak szerveroldalon hívható (lásd lib/supabase/admin.ts, ami server-only). */
export function supabaseSecretKey(): string {
  return required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY);
}
