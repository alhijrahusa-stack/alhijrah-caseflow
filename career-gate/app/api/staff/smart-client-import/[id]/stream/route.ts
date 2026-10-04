import { z } from "zod";
import { sql } from "@/lib/db";
import { staffGuard } from "@/lib/staff-api";
import { traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TERMINAL_PROCESSING = new Set(["EXTRACTED", "REVIEW_REQUIRED", "VERIFIED"]);

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return new Response("Forbidden", { status: 403 });

  const { id: rawId } = await context.params;
  const parsed = z.uuid().safeParse(rawId);
  if (!parsed.success) return new Response("Invalid import case ID", { status: 400 });
  const id = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastEventId: string | null = null;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        const eventId = typeof event.event_id === "string" ? event.event_id : null;
        const prefix = eventId ? `id: ${eventId}\n` : "";
        controller.enqueue(encoder.encode(`${prefix}data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      req.signal.addEventListener("abort", close, { once: true });
      const started = Date.now();
      while (!closed && Date.now() - started < 55_000) {
        const [row] = await sql()`
          select case_number,status,updated_at,verification_result
          from client_import_cases
          where id=${id} and deleted_at is null`;
        if (!row) {
          send({ event_id: `missing:${id}`, event_type: "IMPORT_NOT_FOUND", case_number: null, timestamp: new Date().toISOString(), state: "MISSING" });
          close();
          break;
        }

        const verification = row.verification_result && typeof row.verification_result === "object"
          ? row.verification_result as Record<string, unknown>
          : {};
        const latest = verification.latest_event && typeof verification.latest_event === "object"
          ? verification.latest_event as Record<string, unknown>
          : null;
        const fallbackEvent = {
          event_id: `snapshot:${String(row.updated_at)}`,
          event_type: "IMPORT_STATE_SNAPSHOT",
          case_number: String(row.case_number),
          timestamp: new Date(String(row.updated_at)).toISOString(),
          state: String(verification.processing_state ?? row.status),
          status: String(row.status),
          processing_state: String(verification.processing_state ?? "CAPTURED"),
          ai_state: String(verification.ai_state ?? "SKIPPED"),
          outbox_state: String(verification.outbox_state ?? "NOT_REQUIRED"),
        };
        const event = latest ? { ...fallbackEvent, ...latest } : fallbackEvent;
        const eventId = String(event.event_id);
        if (eventId !== lastEventId) {
          send(event);
          lastEventId = eventId;
        }

        const processing = String(verification.processing_state ?? "");
        if (row.status === "APPROVED_FILE" || TERMINAL_PROCESSING.has(processing)) {
          close();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
