import { createBrowserClient } from "@supabase/ssr";

/**
 * Böngészőoldali Supabase kliens a bejelentkezett felhasználó nevében.
 * Csak ott használjuk, ahol a fájl közvetlenül a böngészőből megy a
 * Storage-ba (import-ábrák, később a tanulói fotók), hogy a nagy fájlok ne
 * a szerveren keresztül utazzanak. Minden művelet RLS / storage policy alatt fut.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
