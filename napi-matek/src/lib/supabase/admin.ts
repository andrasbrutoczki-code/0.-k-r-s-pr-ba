import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/env";

/**
 * Titkos kulcsos (service role) kliens: megkerüli az RLS-t.
 *
 * Kizárólag ott használjuk, ahol nincs (még) felhasználói munkamenet, vagy az
 * Auth admin API kell:
 *   - tanulói belépés (rate limit, kódellenőrzés, munkamenet létrehozása),
 *   - szintetikus Auth felhasználó létrehozása új tanulóhoz.
 * Minden más művelet a felhasználó saját kliensével, RLS alatt fut.
 * A `server-only` import miatt a build hibát ad, ha kliens komponens importálná.
 */
export function createAdminClient() {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
