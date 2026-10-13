import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "@/lib/env";

/**
 * Supabase kliens a bejelentkezett felhasználó nevében (Server Component,
 * Server Action, Route Handler). Minden lekérdezésre az RLS vonatkozik.
 *
 * A munkamenet sütikben él (@supabase/ssr). Server Componentből a sütik nem
 * írhatók – ott a tokenfrissítést a middleware végzi, ezért a setAll hibáját
 * szándékosan elnyeljük.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Componentből hívva: a middleware gondoskodik a frissítésről.
        }
      },
    },
  });
}
