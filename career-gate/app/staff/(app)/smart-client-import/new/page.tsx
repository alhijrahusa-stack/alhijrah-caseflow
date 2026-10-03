import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SmartClientImportMobile } from "@/components/staff/SmartClientImportMobile";
import { getStaffSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Career Gate — Smart Client Import",
  description: "Secure Internal Client Intake",
  openGraph: {
    title: "Career Gate — Smart Client Import",
    description: "Secure Internal Client Intake",
    type: "website",
    images: ["/api/social-preview/career-gate?v=20261003"],
  },
};

export default async function SmartClientImportPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Fsmart-client-import%2Fnew");
  if (session.staff.role === "staff") redirect("/staff");
  return <SmartClientImportMobile />;
}
