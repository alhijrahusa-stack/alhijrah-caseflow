import { z } from "zod";
import { withStaff } from "@/lib/auth";
import { STATUSES } from "@/lib/domain";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { allowedTransitions, workflowRules } from "@/lib/workflow";

export const runtime="nodejs";
const Status=z.enum(STATUSES);

export async function GET(req:Request){
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:false});
  if(guard.response)return guard.response;
  const parsed=Status.safeParse(new URL(req.url).searchParams.get("from"));
  if(!parsed.success)return err("invalid_input","Valid current status is required",400,traceId);
  const data=await withStaff(guard.session,async(tx)=>({
    current:parsed.data,
    allowed:await allowedTransitions(tx,parsed.data),
    all:guard.session.staff.role==="admin"?await workflowRules(tx):[],
  }));
  return ok(data,200,traceId);
}
