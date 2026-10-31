import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/staff/CommandPalette";
import { StaffAppointmentAlerts } from "@/components/staff/StaffAppointmentAlerts";
import { ExecutiveTactileFX } from "@/components/staff/ExecutiveTactileFX";
import { ExecutiveTelemetry } from "@/components/staff/ExecutiveTelemetry";
import { QuickClientSearch } from "@/components/staff/QuickClientSearch";
import { SignOutButton } from "@/components/staff/SignOutButton";
import { ExecutiveShell } from "@/components/staff/ExecutiveShell";
import { executiveSummary } from "@/lib/executive-summary";
import { StaffProvider } from "@/components/staff/StaffContext";
import { SectionBoundary } from "@/components/ui/SectionBoundary";
import { getStaffSession } from "@/lib/auth";
import { OFFICE } from "@/lib/office";
import { staffDirectory } from "@/lib/queries";
import "../operations.css";
import "../dispatcher.css";
import "../extras.css";
import "../executive-design-system.css";
import "../executive-refinement.css";
import "../field-ux.css";
import "../royal-executive.css";

export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const [staff, summary] = await Promise.all([staffDirectory(session), executiveSummary(session)]);
  const mgmt = session.staff.role !== "staff";

  return (
    <StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role }} staff={staff}>
      <SectionBoundary name="tactile-fx" fallback={null}><ExecutiveTactileFX /></SectionBoundary>
      <ExecutiveShell initial={summary} management={mgmt} header={<>
        <Link href="/staff" className="royal-header-brand" prefetch={false}><Image src="/brand/career-gate.webp" alt="Career Gate" width={40} height={40}/><span>CAREER GATE<small>{OFFICE.location}</small></span></Link>
        <div className="royal-command-bar"><SectionBoundary name="quick-search" fallback={null}><QuickClientSearch /></SectionBoundary><SectionBoundary name="command-palette" fallback={null}><CommandPalette /></SectionBoundary></div>
        <div className="royal-session"><SectionBoundary name="telemetry" fallback={null}><ExecutiveTelemetry /></SectionBoundary><StaffAppointmentAlerts staffId={session.staff.id} /><Link href="/staff/staff?tab=team" prefetch={false} aria-label="Executive Profile" data-testid="me">{session.staff.display_name}<small>{session.staff.role}</small></Link><SignOutButton /></div>
      </>}>
        {children}
      </ExecutiveShell>
    </StaffProvider>
  );
}
