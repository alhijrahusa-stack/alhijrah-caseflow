import { StaffText } from "@/components/staff/StaffLanguage";
import { redirect } from "next/navigation";
import { AvailabilitySettings } from "@/components/staff/AvailabilitySettings";
import { getStaffSession } from "@/lib/auth";
import { availability } from "@/lib/queries";

export default async function AvailabilityPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") return <p className="ops-error" data-testid="forbidden"><StaffText en="403 — Admin or manager only." ar="403 — متاح للمسؤول أو المدير فقط."/></p>;
  const data = JSON.parse(JSON.stringify(await availability(session)));
  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero">
        <div>
          <p className="ops-kicker"><StaffText en="CAREER GATE · SCHEDULING CONTROL" ar="CAREER GATE · إدارة الجدولة"/></p>
          <h1><StaffText en="Office Availability" ar="توافر المكتب"/></h1>
          <p><StaffText en="The scheduling engine uses these hours after removing booked appointments and blocked time." ar="تعتمد الجدولة هذه الساعات بعد استبعاد المواعيد المحجوزة والأوقات المحجوبة."/></p>
        </div>
      </header>
      <section className="ops-glass-card"><AvailabilitySettings windows={data.windows} blocked={data.blocked} /></section>
    </div>
  );
}
