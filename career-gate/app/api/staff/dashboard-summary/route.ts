import { getStaffSession } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";
import { executiveSummary } from "@/lib/executive-summary";
import { err,ok } from "@/lib/http";

export const dynamic="force-dynamic";
export async function GET(){
  const session=await getStaffSession();
  if(!session)return err("unauthorized","Sign in required",401);
  try{
    const [summary,canReviewImport]=await Promise.all([executiveSummary(session),permissionAllows(session,"review_smart_import")]);
    const response=ok({summary,permissions:{can_assign:session.staff.role!=="staff",can_review_smart_import:canReviewImport}});
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }catch{return err("summary_unavailable","تعذر تحديث المؤشرات. أعد المحاولة.",503);}
}
