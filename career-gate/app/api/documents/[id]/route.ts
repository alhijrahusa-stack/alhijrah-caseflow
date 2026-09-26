import { z } from "zod";
import { fail, json, parseBody, requireStaff } from "@/lib/api";

const BUCKET = process.env.DOCUMENTS_BUCKET || "client-documents";
const Params = z.uuid();
const Update = z.object({ verified: z.boolean() });

type Ctx = { params: Promise<{ id: string }> };

/** Returns a 60-second signed download URL. */
export async function GET(_req: Request, ctx: Ctx) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const id = Params.safeParse((await ctx.params).id);
  if (!id.success) return fail("Not found", 404);

  const { data: doc } = await staff.supabase
    .from("documents").select("storage_path, file_name").eq("id", id.data).maybeSingle();
  if (!doc) return fail("Not found", 404);

  const { data, error } = await staff.supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error) return fail(error.message, 500);
  return json({ url: data.signedUrl });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const id = Params.safeParse((await ctx.params).id);
  if (!id.success) return fail("Not found", 404);
  const { data, response: bad } = await parseBody(req, Update);
  if (bad) return bad;

  const { data: doc, error } = await staff.supabase
    .from("documents").update({ verified: data.verified }).eq("id", id.data)
    .select("id, client_id, kind").maybeSingle();
  if (error) return fail(error.message, 500);
  if (!doc) return fail("Not found", 404);

  await staff.supabase.from("activity").insert({
    client_id: doc.client_id, actor: staff.user.id, type: "document_reviewed",
    summary: `${doc.kind.replace("_", " ")} document marked ${data.verified ? "verified" : "unverified"}`,
    data: { document_id: doc.id },
  });
  return json(doc);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const id = Params.safeParse((await ctx.params).id);
  if (!id.success) return fail("Not found", 404);

  const { data: doc } = await staff.supabase
    .from("documents").select("id, client_id, kind, storage_path, file_name").eq("id", id.data).maybeSingle();
  if (!doc) return fail("Not found", 404);

  // Remove the object first: a dangling row is visible and retryable, a dangling object is not.
  const { error: rmErr } = await staff.supabase.storage.from(BUCKET).remove([doc.storage_path]);
  if (rmErr) return fail(rmErr.message, 500);
  const { error } = await staff.supabase.from("documents").delete().eq("id", doc.id);
  if (error) return fail(error.message, 500);

  await staff.supabase.from("activity").insert({
    client_id: doc.client_id, actor: staff.user.id, type: "document_deleted",
    summary: `Deleted ${doc.kind.replace("_", " ")} document ${doc.file_name}`,
  });
  return new Response(null, { status: 204 });
}
