import { z } from "zod";
import { sql } from "@/lib/db";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { normalizeDate, reconcileDob, reconcileName } from "@/lib/reconcile";
import { authorize, staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const Input = z.object({ document_id: z.uuid() });
type Field = { field_name?: string; raw_value?: string | null; normalized_value?: string | null };

const reviewState = (state: string) => state === "MATCH" ? "MATCH" : state === "MISMATCH" ? "MISMATCH" : "REVIEW";
const valueOf = (fields: Field[], name: string) => {
  const f = fields.find((x) => x.field_name === name);
  return String(f?.normalized_value ?? f?.raw_value ?? "").trim();
};

function expiryState(raw: string) {
  const normalized = normalizeDate(raw);
  if (!normalized) return { expirationDate: raw, isExpired: false, expiringSoon: false };
  const expiry = Date.parse(`${normalized}T23:59:59.999Z`);
  const now = Date.now();
  return {
    expirationDate: normalized,
    isExpired: expiry < now,
    expiringSoon: expiry >= now && expiry - now <= 90 * 24 * 60 * 60 * 1000,
  };
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;

  const parsed = Input.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return err("invalid_input", "A valid document_id is required", 400, traceId);

  const authz = await authorize(
    req,
    guard.session,
    "view_document",
    { entity: { table: "documents", id: parsed.data.document_id } },
    traceId,
  );
  if (!authz.ok) return authz.response;

  const db = sql();
  const [row] = await db`
    select d.id,d.doc_type,d.status,d.reviewed_by,d.reviewed_at,
           c.full_name,c.date_of_birth,
           e.document_class,e.fields,e.status extraction_status,e.model,e.provider,e.created_at extraction_created_at
    from documents d
    join clients c on c.id=d.client_id
    left join lateral (
      select document_class,fields,status,model,provider,created_at
      from document_extractions
      where document_id=d.id
      order by created_at desc
      limit 1
    ) e on true
    where d.id=${parsed.data.document_id}`;
  if (!row) return err("not_found", "Document not found", 404, traceId);

  const fields = Array.isArray(row.fields) ? row.fields as Field[] : [];
  const fullName = valueOf(fields, "full_name");
  const dob = valueOf(fields, "date_of_birth");
  const expiration = valueOf(fields, "expiration_date");
  const last4 = valueOf(fields, "document_number_last4");
  const language = valueOf(fields, "detected_language");
  const confidence = Number(valueOf(fields, "confidence_score"));
  const name = reconcileName(row.full_name as string | null, fullName || null);
  const dobRecon = reconcileDob(row.date_of_birth as string | null, dob || null);
  const exp = expiryState(expiration);

  return ok({
    extraction: {
      documentType: row.document_class ?? row.doc_type,
      fullName,
      dateOfBirth: normalizeDate(dob) ?? dob,
      expirationDate: exp.expirationDate,
      maskedDocumentNumber: last4 ? `•••• ${last4}` : "",
      detectedLanguage: ["en", "ar", "bilingual"].includes(language) ? language : "",
      confidenceScore: Number.isFinite(confidence) ? confidence : null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      status: row.extraction_status ?? "not_run",
      createdAt: row.extraction_created_at ?? null,
    },
    match: {
      nameMatch: reviewState(name.state),
      nameScore: name.similarity ?? null,
      dobMatch: reviewState(dobRecon.state),
      isExpired: exp.isExpired,
      expiringSoon: exp.expiringSoon,
    },
    human_review_required: true,
  }, 200, traceId);
}
