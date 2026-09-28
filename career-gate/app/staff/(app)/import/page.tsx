import { redirect } from "next/navigation";
import { UniversalIntakePanel } from "@/components/staff/UniversalIntakePanel";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") redirect("/staff");
  return <UniversalIntakePanel />;
}
