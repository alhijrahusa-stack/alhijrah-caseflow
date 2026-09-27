import { redirect } from "next/navigation";
import { Integrations } from "@/components/staff/Integrations";
import { TeamSettings } from "@/components/staff/TeamSettings";
import { getStaffSession } from "@/lib/auth";
import { staffDirectory } from "@/lib/queries";

export default async function TeamPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role !== "admin") return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — Admin only.</p>;
  const staff = await staffDirectory(session);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Team</h1>
      <TeamSettings staff={staff} meId={session.staff.id} />
      <Integrations />
    </div>
  );
}
