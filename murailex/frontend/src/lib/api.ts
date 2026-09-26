export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)murailex_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") headers.set("x-csrf-token", csrf());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, method, headers, body, credentials: "same-origin", cache: "no-store" });
  if (!res.ok) {
    let detail: unknown = undefined;
    let message = res.statusText;
    try {
      const data = await res.json();
      detail = data?.detail;
      if (typeof detail === "string") message = detail;
      else if (detail && typeof detail === "object" && "message" in detail) message = String((detail as { message: string }).message);
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- non-React module; full reload clears state
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { csrf };
