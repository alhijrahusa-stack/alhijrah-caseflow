import { redirect } from "next/navigation";
import { Integrations } from "@/components/staff/Integrations";
import { TeamSettings } from "@/components/staff/TeamSettings";
import { getStaffSession } from "@/lib/auth";
import { staffDirectory } from "@/lib/queries";

export default async function TeamPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role !== "admin") return <p className="ops-error" data-testid="forbidden">403 — Admin only.</p>;
  const staff = await staffDirectory(session);
  const active = staff.filter((member) => member.active).length;
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · ADMINISTRATION</p>
          <h1>Team</h1>
          <p>{active} active staff member{active === 1 ? "" : "s"} · roles, availability and integrations</p>
        </div>
      </header>
      <section className="ops-glass-card"><TeamSettings staff={staff} meId={session.staff.id} /></section>
      <section className="ops-glass-card"><Integrations /></section>
    </div>
  );
}
