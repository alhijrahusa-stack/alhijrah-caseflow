import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AmazonAccountError } from "@/lib/amazon/service";
import { dbErrorResponse, err } from "@/lib/http";

export function amazonErrorResponse(error: unknown, traceId: string) {
  if (error instanceof ZodError) return err("invalid_input", error.issues[0]?.message ?? "Invalid input", 400, traceId);
  if (error instanceof AmazonAccountError) return err(error.code, error.message, error.status, traceId);
  const pg = error as { code?: string; message?: string };
  if (pg?.code === "P0001") return err("invalid_state", "The requested Amazon account operation is not allowed in the current state", 409, traceId);
  return dbErrorResponse(error, traceId);
}

export function secretResponse(value: string, traceId: string) {
  return NextResponse.json(
    { ok: true, value, trace_id: traceId },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
