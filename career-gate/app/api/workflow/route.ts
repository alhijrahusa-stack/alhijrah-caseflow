import { z } from "zod";
import { json, fail, parseBody, requireStaff } from "@/lib/api";
import { STAGES, transition } from "@/lib/workflow/engine";

const Schema = z.object({
  clientId: z.uuid(),
  to: z.enum(STAGES),
  note: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Schema);
  if (bad) return bad;

  const result = await transition(staff.supabase, {
    clientId: data.clientId, to: data.to, actorId: staff.user.id, note: data.note,
  });
  if (!result.ok) return fail(result.error, result.status);
  return json(result);
}
