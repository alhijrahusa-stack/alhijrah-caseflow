import { randomBytes } from "node:crypto";
import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { operationalClientList } from "@/lib/operational-clients";
import { buildRegistryPrint, buildRegistryWorkbook } from "@/lib/registry-export";
import { parseRegistryFilters, REGISTRY_EXPORT_LIMIT } from "@/lib/registry-filters";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const traceId=traceIdFrom(req);
  const guard=await staffGuard(req,traceId,{mutation:false});
  if(guard.response)return guard.response;
  const params=new URL(req.url).searchParams;
  const format=params.get("format");
  if(format!=="xlsx"&&format!=="print")return err("invalid_input","Choose Excel or Print / Save PDF",400,traceId);
  const {view,...filters}=parseRegistryFilters(params,guard.session.staff.role!=="staff");
  const {rows,total}=await operationalClientList(guard.session,view,1,REGISTRY_EXPORT_LIMIT+1,filters);
  if(total>REGISTRY_EXPORT_LIMIT)return err("export_limit",`This view contains ${total} files. Narrow the filters to ${REGISTRY_EXPORT_LIMIT} files or fewer before exporting.`,409,traceId);
  const shared={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow"};
  if(format==="xlsx") {
    const workbook=buildRegistryWorkbook(rows);
    return new Response(workbook,{headers:{...shared,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=\"Career-Gate-Client-Registry.xlsx\""}});
  }
  const nonce=randomBytes(18).toString("base64");
  return new Response(buildRegistryPrint(rows,view,nonce,new Date().toISOString()),{headers:{...shared,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'self'`}});
}
