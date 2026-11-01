import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { StaffLanguageProvider, StaffLanguageToggle, StaffText } from "@/components/staff/StaffLanguage";
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
import { permissionAllows } from "@/lib/authz";
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
export const metadata: Metadata = { manifest: "/staff.webmanifest" };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const [staff, summary, cookieStore, canScheduleAppointment, canReviewSmartImport] = await Promise.all([staffDirectory(session), executiveSummary(session), cookies(), permissionAllows(session, "schedule_appointment"), permissionAllows(session, "review_smart_import")]);
  const mgmt = session.staff.role !== "staff";
  const initialLanguage = cookieStore.get("cg-staff-language")?.value === "ar" ? "ar" : "en";

  return (
    <StaffLanguageProvider initialLanguage={initialLanguage}><StaffProvider me={{ id: session.staff.id, display_name: session.staff.display_name, role: session.staff.role, canScheduleAppointment, canReviewSmartImport }} staff={staff}>
      <SectionBoundary name="tactile-fx" fallback={null}><ExecutiveTactileFX /></SectionBoundary>
      <ExecutiveShell initial={summary} management={mgmt} header={<>
        <Link href="/staff" className="royal-header-brand" prefetch={false}><Image src="/brand/career-gate.webp" alt="Career Gate" width={48} height={48}/><span>CAREER GATE<small>{OFFICE.location}</small></span></Link>
        <div className="royal-command-bar"><SectionBoundary name="quick-search" fallback={null}><QuickClientSearch /></SectionBoundary><SectionBoundary name="command-palette" fallback={null}><CommandPalette /></SectionBoundary></div>
        <div className="royal-session"><StaffLanguageToggle /><SectionBoundary name="telemetry" fallback={null}><ExecutiveTelemetry /></SectionBoundary><StaffAppointmentAlerts staffId={session.staff.id} /><Link href="/staff/staff?tab=team" prefetch={false} title="Executive Profile" data-testid="me"><bdi>{session.staff.display_name}</bdi><span className="sr-only"><StaffText en="Executive Profile" ar="الملف التنفيذي"/></span><small>{session.staff.role}</small></Link><SignOutButton /></div>
      </>}>
        {children}
      </ExecutiveShell>
    </StaffProvider></StaffLanguageProvider>
  );
}
