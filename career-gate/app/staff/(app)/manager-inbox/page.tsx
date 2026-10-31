import { redirect } from "next/navigation";
import { ManagerTaskCenter } from "@/components/staff/ManagerTaskCenter";
import { getStaffSession } from "@/lib/auth";
import { managerInbox } from "@/lib/manager-inbox";

export const dynamic = "force-dynamic";
export default async function ManagerInboxPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error" data-testid="forbidden">403 — Admin or manager only.</p>;
  return <ManagerTaskCenter initial={await managerInbox(session)} />;
}
