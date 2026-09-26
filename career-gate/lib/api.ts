import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";
import { getStaff } from "@/lib/supabase/server";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Resolves the staff caller or returns a 401 response to send back. */
export async function requireStaff() {
  const staff = await getStaff();
  if (!staff) return { staff: null, response: fail("Unauthorized", 401) } as const;
  return { staff, response: null } as const;
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T) {
  const raw = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { data: null, response: fail(msg, 400) } as const;
  }
  return { data: parsed.data as z.infer<T>, response: null } as const;
}
