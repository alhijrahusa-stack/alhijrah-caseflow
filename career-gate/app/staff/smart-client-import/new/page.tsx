import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClientIntakeLinkPanel } from "@/components/staff/ClientIntakeLinkPanel";
import { MobileSmartImportForm } from "@/components/staff/MobileSmartImportForm";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Career Gate — Smart Client Import",
  description: "Secure Internal Client Intake",
  alternates: { canonical: "/staff/smart-client-import/new" },
  openGraph: {
    title: "Career Gate — Smart Client Import",
    description: "Secure Internal Client Intake",
    type: "website",
    images: [{ url: "/api/social-preview/career-gate?v=20261004-smart-import", width: 1200, height: 630, alt: "Career Gate — Smart Client Import" }],
  },
};

export default async function SmartClientImportMobilePage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Fsmart-client-import%2Fnew");
  if (session.staff.role === "staff") redirect("/staff");
  return (
    <>
      <div id="client-self-intake" className="mx-auto w-full max-w-[1180px] scroll-mt-28 px-4 pt-5 sm:px-6">
        <ClientIntakeLinkPanel />
      </div>
      <MobileSmartImportForm staff={{ display_name: session.staff.display_name }} />
    </>
  );
}
