import { redirect } from "next/navigation";
import { OperationalWorkWindow } from "@/components/staff/OperationalWorkWindow";
import { getStaffSession } from "@/lib/auth";
import { operationalWorkWindow } from "@/lib/operational-work-window";

export const dynamic = "force-dynamic";

export default async function TodayRoute() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const data = await operationalWorkWindow(session, "today");
  return <OperationalWorkWindow kind="today" data={data} />;
}
