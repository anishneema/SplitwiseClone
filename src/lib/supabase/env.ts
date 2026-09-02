/**
 * Supabase credentials, read in one place so a missing `.env.local` produces a
 * setup screen instead of an opaque runtime crash.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Supabase renamed the browser key from "anon" to "publishable"; accept either
// so a key copied from any dashboard vintage works.
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function requireSupabaseEnv(): { url: string; key: string } {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and fill in " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}
