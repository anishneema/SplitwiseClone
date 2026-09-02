"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/types/database";
import { requireSupabaseEnv } from "./env";

type Client = ReturnType<typeof createBrowserClient<Database>>;

// Memoized so every component shares one client, and therefore one Realtime
// websocket, instead of opening a socket per subscription.
let browserClient: Client | undefined;

export function createClient(): Client {
  if (!browserClient) {
    const { url, key } = requireSupabaseEnv();
    browserClient = createBrowserClient<Database>(url, key);
  }
  return browserClient;
}
