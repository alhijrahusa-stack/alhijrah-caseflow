import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { PublicStatusView } from "@/components/PublicStatusView";
import { StatusPoller } from "@/components/StatusPoller";
import { publicImportStatus, publicStatus } from "@/lib/public-status";
import { sessionStatusSubject, STATUS_COOKIE } from "@/lib/status-access";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StatusPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ appointment_action?: string }> }) {
  const { ref } = await params;
  const { appointment_action } = await searchParams;
  const r = decodeURIComponent(ref).trim().toUpperCase();
  const token = (await cookies()).get(STATUS_COOKIE)?.value;
  const subject = await sessionStatusSubject(r, token);

  if (!subject) {
    return (
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-auth-required">
        <h1 className="text-xl font-semibold">Verification required</h1>
        <p className="text-sm text-slate-600">Verify your file number, phone, or email to view application details.</p>
        <Link href={`/status?ref=${encodeURIComponent(r)}`} className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">Verify & View Status</Link>
      </section>
    );
  }

  const s = subject.clientId ? await publicStatus(subject.clientId) : subject.importCaseId ? await publicImportStatus(subject.importCaseId) : null;
  if (!s) {
    return (
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-not-found">
        <h1 className="text-xl font-semibold">File not found</h1>
        <p className="text-sm text-slate-600">The verified file is no longer available.</p>
        <Link href="/status" className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">Search status</Link>
      </section>
    );
  }

  return (
    <>
      <PublicStatusView s={s} verifiedRef={r} appointmentAction={appointment_action} />
      <StatusPoller refCode={s.ref} />
    </>
  );
}
