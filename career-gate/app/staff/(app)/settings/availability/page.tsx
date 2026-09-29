import { redirect } from "next/navigation";
import { AvailabilitySettings } from "@/components/staff/AvailabilitySettings";
import { getStaffSession } from "@/lib/auth";
import { availability } from "@/lib/queries";

export default async function AvailabilityPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error" data-testid="forbidden">403 — Admin or manager only.</p>;
  const data = JSON.parse(JSON.stringify(await availability(session)));
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · SCHEDULING CONTROL</p>
          <h1>Office Availability</h1>
          <p>The scheduling engine uses these hours after removing booked appointments and blocked time.</p>
        </div>
      </header>
      <section className="ops-glass-card"><AvailabilitySettings windows={data.windows} blocked={data.blocked} /></section>
    </div>
  );
}
