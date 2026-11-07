import { describe, expect, it } from "vitest";
import { createStaffRealtimeClient } from "@/lib/staff-realtime-client";

describe("signed-in staff Realtime token source", () => {
  it("keeps the staff token when Realtime refreshes from its callback instead of falling back to the public key", async () => {
    const connection = createStaffRealtimeClient("https://project.supabase.co", "public-key", "staff-session-one");
    await connection.setToken("staff-session-one");
    // Realtime calls setAuth() without an override on heartbeat/reconnect.
    await connection.client.realtime.setAuth();
    expect(connection.client.realtime.accessTokenValue).toBe("staff-session-one");
    await connection.setToken("staff-session-two");
    await connection.client.realtime.setAuth();
    expect(connection.client.realtime.accessTokenValue).toBe("staff-session-two");
    await connection.client.removeAllChannels();
  });

  it("does not silently downgrade an authenticated connection to an empty token", async () => {
    expect(() => createStaffRealtimeClient("https://project.supabase.co", "public-key", "")).toThrow("signed-in staff token");
    const connection = createStaffRealtimeClient("https://project.supabase.co", "public-key", "staff-session");
    await expect(connection.setToken(" ")).rejects.toThrow("signed-in staff token");
    await connection.client.realtime.setAuth();
    expect(connection.client.realtime.accessTokenValue).toBe("staff-session");
    await connection.client.removeAllChannels();
  });
});
