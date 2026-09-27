import { randomUUID } from "node:crypto";

// Structured logs. Callers pass only non-sensitive fields; `redact` drops
// anything whose key looks secret.
const SECRET_KEY = /pass|otp|token|secret|api_?key|ssn|authorization|cookie|signature|dob|birth|a_number|identifier|^code$/i;

export function newTraceId() {
  return randomUUID();
}

export function traceIdFrom(req: Request) {
  const h = req.headers.get("x-trace-id") ?? req.headers.get("x-request-id");
  return h && /^[\w-]{8,100}$/.test(h) ? h : newTraceId();
}

function redact(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : v;
  return out;
}

export function log(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Times an operation and logs route, operation, duration_ms, result and error_code. */
export async function observe<T>(
  meta: { trace_id: string; route: string; operation: string },
  fn: () => Promise<T>,
  result: (v: T) => { result: string; error_code?: string | null } = () => ({ result: "ok" }),
): Promise<T> {
  const t0 = performance.now();
  try {
    const v = await fn();
    const r = result(v);
    log(r.result === "ok" ? "info" : "warn", { ...meta, duration_ms: Math.round(performance.now() - t0), ...r });
    return v;
  } catch (e) {
    log("error", {
      ...meta,
      duration_ms: Math.round(performance.now() - t0),
      result: "exception",
      error_code: (e as { code?: string })?.code ?? "exception",
      error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown",
    });
    throw e;
  }
}
