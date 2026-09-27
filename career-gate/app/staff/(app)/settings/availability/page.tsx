import { redirect } from "next/navigation";
import { AvailabilitySettings } from "@/components/staff/AvailabilitySettings";
import { getStaffSession } from "@/lib/auth";
import { availability } from "@/lib/queries";

export default async function AvailabilityPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — Admin or manager only.</p>;
  const data = JSON.parse(JSON.stringify(await availability(session)));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Office availability</h1>
      <p className="text-sm text-slate-500">The scheduling engine offers slots from these hours, minus booked appointments and blocked time.</p>
      <AvailabilitySettings windows={data.windows} blocked={data.blocked} />
    </div>
  );
}
