import { redirect } from "next/navigation";
import { GateJobQuickAdd } from "@/components/gate-job-account/GateJobQuickAdd";
import { getStaffSession } from "@/lib/auth";

export default async function GateJobQuickAddPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Fgate-job-account%2Fquick-add");
  return <GateJobQuickAdd />;
}
