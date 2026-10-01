import { getStaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ ok: false, status: "UNAVAILABLE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const started = performance.now();
  try {
    await sql()`select 1 as ok`;
    const dbMs = Math.round(performance.now() - started);
    const status = dbMs > 1000 ? "DEGRADED" : "HEALTHY";
    return NextResponse.json({ ok: true, status, dbMs }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, status: "UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
