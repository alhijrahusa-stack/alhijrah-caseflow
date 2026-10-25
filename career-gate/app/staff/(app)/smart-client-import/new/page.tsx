import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SmartImportNewRedirect() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") redirect("/staff");
  redirect("/staff/import");
}
