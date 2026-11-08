import { after } from "next/server";
import { z } from "zod";
import { permissionAllows } from "@/lib/authz";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { processJobs } from "@/lib/jobs";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import { WorksiteChangeInput } from "@/lib/worksite-change-schema";
import { executeWorksiteChange, getWorksiteChanges } from "@/lib/worksite-changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function privateResponse(response: Response) {response.headers.set('Cache-Control','private, no-store');return response;}
function failure(error: unknown,trace: string) {return error instanceof ActionError ? err(error.code,error.message,error.status,trace) : dbErrorResponse(error,trace);}
export async function GET(req: Request) {
  const trace=traceIdFrom(req),guard=await staffGuard(req,trace,{mutation:false});
  if (guard.response) return privateResponse(guard.response);
  const params=new URL(req.url).searchParams;
  const parsed=z.object({tab:z.enum(['pending','confirmed']).default('pending'),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).safeParse(Object.fromEntries(params));
  if (!parsed.success) return privateResponse(err('invalid_input','Invalid worksite filters',400,trace));
  try {return privateResponse(ok({data:await getWorksiteChanges(guard.session,parsed.data)},200,trace));}
  catch(error) {return privateResponse(failure(error,trace));}
}
export async function POST(req: Request) {
  const trace=traceIdFrom(req),guard=await staffGuard(req,trace,{mutation:true});
  if (guard.response) return privateResponse(guard.response);
  const parsed=WorksiteChangeInput.safeParse(await req.json().catch(()=>null));
  if (!parsed.success) return privateResponse(err('invalid_input',parsed.error.issues[0]?.message??'Invalid worksite request',400,trace));
  try {
    if (!await permissionAllows(guard.session,'update_client')) throw new ActionError('forbidden','Client update permission required',403);
    const result=await executeWorksiteChange(guard.session,parsed.data,trace);
    if (parsed.data.operation!=='save_request') after(async()=>{await processJobs(10,{types:['notification_send'],concurrency:3});});
    return privateResponse(ok(result,200,trace));
  } catch(error) {return privateResponse(failure(error,trace));}
}
