import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PublicStatusView } from "@/components/PublicStatusView";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { publicStatus } from "@/lib/public-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exactly what the client sees after verifying at /status (same projection). */
export default async function StatusPreview({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) notFound();
  const s = await publicStatus(id);
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-[640px] space-y-3">
      <p className="text-sm text-slate-500"><StaffText en="Staff preview only. Appointment actions are available to clients after one-time verification at /status." ar="معاينة للموظفين فقط. تتاح إجراءات المواعيد للعملاء بعد التحقق لمرة واحدة عبر /status."/></p>
      <PublicStatusView s={s} readOnly />
      <Link href={`/staff/client/${id}`} className="text-sm text-brand-700 hover:underline"><StaffText en="← Back to client file" ar="العودة إلى ملف العميل →"/></Link>
    </div>
  );
}
