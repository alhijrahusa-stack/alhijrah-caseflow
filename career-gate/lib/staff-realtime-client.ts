"use client";

import { createClient } from "@supabase/supabase-js";

/** The signed-in staff token remains authoritative on every Realtime heartbeat. */
export function createStaffRealtimeClient(url: string, publishableKey: string, initialToken: string) {
  if (!initialToken?.trim()) throw new Error("A signed-in staff token is required for Realtime");
  let currentToken = initialToken;
  const client = createClient(url, publishableKey, {
    accessToken: async () => currentToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    client,
    async setToken(token: string) {
      if (!token?.trim()) throw new Error("A signed-in staff token is required for Realtime");
      currentToken = token;
      await client.realtime.setAuth(token);
    },
  };
}
