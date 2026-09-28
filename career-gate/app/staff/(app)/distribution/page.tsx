import { redirect } from "next/navigation";
import { DistributionPanel } from "@/components/staff/DistributionPanel";
import { getStaffSession } from "@/lib/auth";
import { distributionData } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error">403 — Management access required.</p>;
  const data = await distributionData(session);
  return <DistributionPanel staff={data.staff} clients={data.clients} settings={data.settings} isAdmin={session.staff.role === "admin"} />;
}
