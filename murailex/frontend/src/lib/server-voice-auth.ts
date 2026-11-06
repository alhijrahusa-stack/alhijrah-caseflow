import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

type SessionPayload = {
  csrf_token?: unknown;
  user?: { role?: unknown };
};

function sameToken(sent: string, expected: string): boolean {
  const a = Buffer.from(sent, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** Verify real MURAILEX session, upload permission and CSRF on every call. */
export async function authorizeVoiceRequest(request: Request): Promise<NextResponse | null> {
  const cookie = request.headers.get("cookie");
  const csrf = request.headers.get("x-csrf-token");
  if (!cookie || !csrf) {
    return NextResponse.json({ error: "Authentication and CSRF token required." }, { status: 401 });
  }

  const base = process.env.BACKEND_INTERNAL_URL;
  if (!base) {
    return NextResponse.json({ error: "MURAILEX authentication service unavailable." }, { status: 503 });
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/api/auth/me", base);
    if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Invalid scheme");
  } catch {
    return NextResponse.json({ error: "MURAILEX authentication configuration invalid." }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { cookie },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return NextResponse.json({ error: "MURAILEX authentication service unavailable." }, { status: 503 });
  }
  if (response.status !== 200) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let payload: SessionPayload;
  try {
    payload = (await response.json()) as SessionPayload;
  } catch {
    return NextResponse.json({ error: "Invalid session response." }, { status: 503 });
  }
  if (typeof payload.csrf_token !== "string" || !sameToken(csrf, payload.csrf_token)) {
    return NextResponse.json({ error: "CSRF validation failed." }, { status: 403 });
  }
  if (payload.user?.role !== "admin" && payload.user?.role !== "transcriber") {
    return NextResponse.json({ error: "Transcription permission required." }, { status: 403 });
  }
  return null;
}
