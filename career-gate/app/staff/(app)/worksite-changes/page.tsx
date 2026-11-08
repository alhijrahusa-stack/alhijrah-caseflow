import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { getWorksiteChanges } from "@/lib/worksite-changes";
import { WorksiteChangeCenter } from "@/components/staff/WorksiteChangeCenter";
import "@/components/staff/worksite-changes.css";

export const dynamic = "force-dynamic";

export default async function WorksiteChangesPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  return <WorksiteChangeCenter initial={await getWorksiteChanges(session, { tab: "pending", q: "", page: 1 })} viewerId={session.staff.id} />;
}
