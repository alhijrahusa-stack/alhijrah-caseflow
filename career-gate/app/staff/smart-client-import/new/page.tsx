import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExecutiveSmartImportForm } from "@/components/staff/ExecutiveSmartImportForm";
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
  return <ExecutiveSmartImportForm staff={{ display_name: session.staff.display_name }} />;
}
