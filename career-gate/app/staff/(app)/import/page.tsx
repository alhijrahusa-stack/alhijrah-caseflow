import { redirect } from "next/navigation";
import { SmartCareerCollectClient } from "@/components/staff/SmartCareerCollectClient";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Fimport");
  if (session.staff.role === "staff") redirect("/staff");
  return <SmartCareerCollectClient />;
}
