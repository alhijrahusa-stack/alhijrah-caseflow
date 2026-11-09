import { redirect } from "next/navigation";
import { UniversalIntakePanel } from "@/components/staff/UniversalIntakePanel";
import { ImportDuplicateCenter } from "@/components/staff/ImportDuplicateCenter";
import { StaffText } from "@/components/staff/StaffLanguage";
import { permissionAllows } from "@/lib/authz";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") {
    if (!await permissionAllows(session, "add_task")) redirect("/staff");
    const params = await searchParams;
    const caseId = typeof params.case === "string" && /^[a-f0-9-]{36}$/i.test(params.case) ? params.case : undefined;
    return <div className="ops-page space-y-5"><header className="ops-hero"><div><h1><StaffText en="Import Queue" ar="قائمة انتظار الاستيراد" /></h1><p><StaffText en="Check all queued clients and send a verified comparison to your manager." ar="افحص جميع ملفات الانتظار وحوّل المقارنة المتحققة إلى المدير." /></p></div></header><ImportDuplicateCenter initialCaseId={caseId} initialOpen={Boolean(caseId)} /></div>;
  }
  return <UniversalIntakePanel />;
}
