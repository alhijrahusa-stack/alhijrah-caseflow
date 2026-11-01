import { redirect } from "next/navigation";
import { UniversalIntakePanel } from "@/components/staff/UniversalIntakePanel";
import { getStaffSession } from "@/lib/auth";
import { permissionAllows } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (!(await permissionAllows(session, "review_smart_import"))) redirect("/staff");
  return <UniversalIntakePanel />;
}
