import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSharedStaffRealtime } from "@/lib/shared-staff-realtime";
import { createStaffRealtimeClient } from "@/lib/staff-realtime-client";

vi.mock("@/lib/staff-realtime-client", () => ({ createStaffRealtimeClient: vi.fn() }));
type Callback = (...args: unknown[]) => void;
function transport() {
  const channels = new Map<string, { handlers: Map<string, Callback>; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; status?: Callback }>();
  const client = {
    channel: vi.fn((topic: string) => {
      if (!channels.has(topic)) {
        const channel = { handlers: new Map<string, Callback>(), on: vi.fn(), subscribe: vi.fn(), status: undefined as Callback | undefined };
        channel.on.mockImplementation((event, _filter, callback) => { channel.handlers.set(event, callback); return channel; });
        channel.subscribe.mockImplementation(callback => { channel.status = callback; callback("SUBSCRIBED"); return channel; });
        channels.set(topic, channel);
      }
      return channels.get(topic);
    }),
    removeChannel: vi.fn(async () => "ok"), removeAllChannels: vi.fn(async () => []),
  };
  const connection = { client, setToken: vi.fn(async () => undefined) };
  vi.mocked(createStaffRealtimeClient).mockReturnValue(connection as unknown as ReturnType<typeof createStaffRealtimeClient>);
  return { ...connection, channels };
}
const bootstrap = (staff_id: string, token = "test-staff-token") => Response.json({ ok: true, staff_id, token, url: "https://project.supabase.co", anon_key: "public-key" });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-09T18:00:00Z")); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("staff-scoped shared realtime transport", () => {
  it("collapses three concurrent bootstraps and token rotations into one request and client", async () => {
    const socket = transport(), fetcher = vi.fn(async () => bootstrap("staff-a"));
    const session = createSharedStaffRealtime("staff-a", fetcher);
    const clients = await Promise.all([session.connect(), session.connect(), session.connect()]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(createStaffRealtimeClient).toHaveBeenCalledTimes(1);
    expect(clients.every(client => client === clients[0])).toBe(true);
    fetcher.mockImplementation(async () => bootstrap("staff-a", "rotated-staff-token"));
    vi.setSystemTime(new Date("2026-11-09T18:04:00Z"));
    await Promise.all([session.connect(), session.connect(), session.connect()]);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(socket.setToken).toHaveBeenCalledTimes(2);
    expect(createStaffRealtimeClient).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it("keeps publisher and manager reader on one channel and removes only the released listener", async () => {
    const socket = transport(), session = createSharedStaffRealtime("staff-a", vi.fn(async () => bootstrap("staff-a")));
    await session.connect();
    const publisher = session.lease("team-presence:auth-a", true), reader = session.lease("team-presence:auth-a", true);
    const first = vi.fn(), second = vi.fn(), state = vi.fn();
    publisher.onPresence(first); reader.onPresence(second); publisher.subscribe(state); reader.subscribe(state);
    const channel = socket.channels.get("team-presence:auth-a")!;
    expect(socket.client.channel).toHaveBeenCalledTimes(1); expect(channel.subscribe).toHaveBeenCalledTimes(1);
    channel.handlers.get("presence")!(); expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    reader.release(); await vi.advanceTimersByTimeAsync(1);
    expect(socket.client.removeChannel).not.toHaveBeenCalled();
    channel.handlers.get("presence")!(); expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(1);
    publisher.release(); await vi.advanceTimersByTimeAsync(1);
    expect(socket.client.removeChannel).toHaveBeenCalledTimes(1); session.dispose();
  });
  it("does not share identity or accept a late bootstrap after disposal", async () => {
    transport();
    const wrong = createSharedStaffRealtime("staff-a", vi.fn(async () => bootstrap("staff-b")));
    await expect(wrong.connect()).rejects.toThrow("authentication unavailable");
    expect(createStaffRealtimeClient).not.toHaveBeenCalled(); wrong.dispose();
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(done => { resolve = done; });
    const session = createSharedStaffRealtime("staff-a", vi.fn(() => pending));
    const work = session.connect(); session.dispose(); resolve(bootstrap("staff-a"));
    await expect(work).rejects.toThrow("session has ended"); expect(createStaffRealtimeClient).not.toHaveBeenCalled();
  });
  it("allows an immediate effect remount to reuse its channel without closing the socket", async () => {
    const socket = transport(), session = createSharedStaffRealtime("staff-a", vi.fn(async () => bootstrap("staff-a")));
    await session.connect(); const first = session.lease("staff-operations"); first.release();
    const second = session.lease("staff-operations"); await vi.advanceTimersByTimeAsync(1);
    expect(socket.client.removeChannel).not.toHaveBeenCalled();
    second.release(); await vi.advanceTimersByTimeAsync(1); expect(socket.client.removeChannel).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
