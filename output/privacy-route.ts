import { admin,candidateOwned,sameOrigin,readJson,errorResponse } from '@/lib/server';
import { privacyLedger,holdActive,handlePrivacyRequest,privacyRequestSchema,PRIVACY_POLICY_APPROVED,RETAINED_PENDING_POLICY } from '@/lib/privacy';
// v2.2 Gate 6 — privacy lifecycle of one case (MANAGER only): ledger, legal hold, access export, correction record and
// controlled erasure. Every request is recorded in the append-only privacy_requests ledger.
type Context={params:Promise<{id:string}>};
const noStore={'Cache-Control':'private, no-store'};
export async function GET(_r:Request,ctx:Context){try{const s=await admin(),{id}=await ctx.params;await candidateOwned(id,s.scope);return Response.json({ledger:await privacyLedger(id),holdActive:await holdActive(id),policyApproved:PRIVACY_POLICY_APPROVED,retainedPendingPolicy:RETAINED_PENDING_POLICY},{headers:noStore});}catch(e){return errorResponse(e);}}
export async function POST(request:Request,ctx:Context){try{sameOrigin(request);const s=await admin(),{id}=await ctx.params;await candidateOwned(id,s.scope);const d=await readJson(request,privacyRequestSchema);
 return Response.json(await handlePrivacyRequest(id,s.authority.actor.userId,d),{headers:noStore});}catch(e){return errorResponse(e);}}
