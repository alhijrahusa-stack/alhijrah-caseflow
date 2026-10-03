import { redirect } from "next/navigation";
import { GateJobAccountWorkspace } from "@/components/gate-job-account/GateJobAccountWorkspace";
import { getStaffSession } from "@/lib/auth";

export default async function Gate JobAccountPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Fgate-job-account");
  return <GateJobAccountWorkspace />;
}
