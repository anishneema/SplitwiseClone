import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { requireSupabaseEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Always create a fresh one per request — never hoist it to a module-level
 * constant, or one user's session leaks into another's request.
 */
export async function createSupabaseServerClient() {
  const { url, key } = requireSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, key, {
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
          // Server Components get a read-only cookie store. Token refresh is
          // handled in proxy.ts, so there is nothing to do here.
        }
      },
    },
  });
}
