import "server-only";
import { NextResponse } from "next/server";
import { hashIdentifier } from "@/lib/crypto";

export type ApiError = { ok: false; error: { code: string; message: string }; trace_id?: string };

export function ok<T extends object>(data: T, status = 200, traceId?: string) {
  return NextResponse.json({ ok: true, ...data, ...(traceId ? { trace_id: traceId } : {}) }, { status });
}

export function err(code: string, message: string, status = 400, traceId?: string) {
  return NextResponse.json(
    { ok: false, error: { code, message }, ...(traceId ? { trace_id: traceId } : {}) } satisfies ApiError,
    { status },
  );
}

/** Client IP as set by Vercel's edge; falls back to proxy headers elsewhere. */
export function clientIp(req: Request) {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export const ipHash = (req: Request) => hashIdentifier(`ip:${clientIp(req)}`);

/** Postgres errors become typed API errors instead of opaque 500s. */
export function dbErrorResponse(e: unknown, traceId?: string) {
  const pg = e as { code?: string; message?: string; constraint_name?: string };
  if (pg?.code === "P0001" && pg.message?.startsWith("duplicate_client_identity|")) {
    const [, identity, ref, stage, owner] = pg.message.split("|");
    const field = identity === "email" ? "البريد الإلكتروني" : "رقم الهاتف";
    return err(
      "duplicate_client",
      `تنبيه النظام: ${field} مسجل مسبقاً في الملف ${ref}. القسم الحالي: ${stage.replace(/_/g, " ")}. الموظف المسؤول: ${owner}. افتح الملف الحالي أو اطلب نقل الملكية بدلاً من إنشاء نسخة جديدة.`,
      409,
      traceId,
    );
  }
  if (pg?.code === "P0001" && pg.message?.startsWith("invalid_status_transition")) {
    return err("invalid_transition", "That status change is not allowed from the current status", 409, traceId);
  }
  if (pg?.code === "P0001" && pg.message?.startsWith("invalid_initial_status")) {
    return err("invalid_transition", "A new client must start as New Intake, Needs Review or Ready to Apply", 400, traceId);
  }
  if (pg?.code === "23P01") return err("slot_taken", "That time overlaps another appointment for the same resource", 409, traceId);
  if (pg?.code === "23505") return err("conflict", "That record already exists", 409, traceId);
  if (pg?.code === "42501") return err("forbidden", "Not permitted", 403, traceId);
  if (pg?.code === "23514" || pg?.code === "22P02" || pg?.code === "22007" || pg?.code === "22008") {
    return err("invalid_input", `A value was rejected by the database (${pg.constraint_name ?? pg.code})`, 400, traceId);
  }
  if (pg?.code === "23503") return err("invalid_reference", "A referenced record does not exist", 400, traceId);
  console.error(e);
  return err("server_error", "The server could not complete the request", 500, traceId);
}
