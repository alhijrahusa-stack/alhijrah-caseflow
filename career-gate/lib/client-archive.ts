import "server-only";
import type { StaffSession, Tx } from "@/lib/auth";
import { ActionError } from "@/lib/service";
export async function archiveClient(tx:Tx,session:{staff:Pick<StaffSession["staff"],"id"|"role">},clientId:string,reason:string,traceId:string){
 if(!['admin','manager'].includes(session.staff.role))throw new ActionError('forbidden','Management access required',403);
 if(!reason.trim())throw new ActionError('reason_required','A deletion reason is required',400);
 const [row]=await tx`select career_gate_private.archive_client(${clientId},${reason.trim()},${traceId}) result`;
 return row.result as {id:string;changed:boolean;archived:boolean};
}
