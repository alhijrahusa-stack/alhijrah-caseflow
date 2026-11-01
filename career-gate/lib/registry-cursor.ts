export type RegistryCursor = { time: string; id: string; direction: "after" | "before" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeRegistryCursor(value: RegistryCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeRegistryCursor(value: string | undefined): RegistryCursor | null {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed.time !== "string" || !TIMESTAMP.test(parsed.time) || parsed.time.startsWith("0000-") || Number.isNaN(Date.parse(parsed.time)) ||
      new Date(parsed.time).toISOString().slice(0, 19) !== parsed.time.slice(0, 19) ||
      typeof parsed.id !== "string" || !UUID.test(parsed.id) || (parsed.direction !== "after" && parsed.direction !== "before")) return null;
    return { time: parsed.time, id: parsed.id, direction: parsed.direction };
  } catch { return null; }
}
