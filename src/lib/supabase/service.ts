import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS — the ONLY client allowed to write reference tables
 * (`instruments`, `prices`). Server-only: uses SUPABASE_SERVICE_ROLE_KEY, never sent to the browser.
 * Create inside a handler, never at module scope (prerender would run it with no env).
 */
export function createSupabaseService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
