import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { stageMobileImportV2 } from "@/lib/smart-client-mobile";
import {
  CLIENT_EDITABLE_FIELDS,
  claimIntakeLink,
  composeIntakeSource,
  finalizeIntakeLink,
  intakeIdempotencyKey,
  releaseIntakeLink,
  type ClientEditableField,
} from "@/lib/client-intake-link";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The client's own submission, through a one-time link.
 *
 * No staff session is involved and the browser never touches the database. The
 * link is claimed atomically, the submission is handed to the existing Smart
 * Client Import staging unchanged, and only once that staging succeeds is the
 * link marked USED.
 *
 * The idempotency key is derived from the link alone, so a retry after a crash
 * — or a recovery of a stale PROCESSING state — reaches the same staged case
 * instead of creating a second one.
 *
 * The raw token is never logged. It appears only in the request path.
 */

const MAX_EDIT_LENGTH = 200;

function readEdits(form: FormData): Partial<Record<ClientEditableField, string>> {
  const edits: Partial<Record<ClientEditableField, string>> = {};
  for (const field of CLIENT_EDITABLE_FIELDS) {
    const raw = form.get(`field_${field}`);
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, MAX_EDIT_LENGTH);
    if (value) edits[field] = value;
  }
  return edits;
}

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const traceId = traceIdFrom(req);
  const { token } = await context.params;

  const claim = await claimIntakeLink(token);
  if (!claim.ok) {
    if (claim.reason === "not_found") return err("not_found", "This link is not valid", 404, traceId);
    if (claim.reason === "busy") return err("in_progress", "This submission is already being processed", 409, traceId);
    if (claim.reason === "issuer_not_authorized") {
      return err("link_unavailable", "This link is no longer available. Please contact the office.", 410, traceId);
    }
    return err("link_closed", "This link has already been used or is no longer valid", 410, traceId);
  }

  const { link } = claim;
  try {
    const form = await req.formData();
    const sourceText = String(form.get("source_text") ?? "");
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

    // The client's corrections are written as canonical labelled lines ahead of
    // the text they typed, so an edit wins over what was detected in the free
    // text while the existing parser stays authoritative for everything else.
    const notes = composeIntakeSource(sourceText, readEdits(form));

    const result = await stageMobileImportV2({
      session: link.issuer,
      notes,
      files,
      idempotencyKey: intakeIdempotencyKey(link.tokenHash),
    });

    const finalized = await finalizeIntakeLink(link.id, result.case_id);
    if (!finalized) {
      // The case exists but the link could not be closed against it. Reporting
      // success would leave a link that still looks usable.
      return err("link_not_closed", "Your information was received but the link could not be closed. Please contact the office.", 409, traceId);
    }

    // Nothing internal is returned: no case id, no batch id, no staff identity.
    return ok({ received: true }, 201, traceId);
  } catch (error) {
    // The submission failed, so the link goes back to ACTIVE and the client may
    // try again while it has not expired.
    await releaseIntakeLink(link.id);
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("submission_failed", "Your information could not be submitted. Please try again.", 500, traceId);
  }
}
