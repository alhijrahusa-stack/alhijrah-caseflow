import type { Metadata } from "next";
import Link from "next/link";
import { PublicStatusView } from "@/components/PublicStatusView";
import { StatusPoller } from "@/components/StatusPoller";
import { publicStatus } from "@/lib/public-status";
import { cookies } from "next/headers";
import { sessionClient, STATUS_COOKIE } from "@/lib/status-access";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Requires a verified status session bound to this reference. */
export default async function StatusPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const r = decodeURIComponent(ref).toUpperCase();
  const clientId = /^CG-\d{4}-\d{6}$/.test(r) ? await sessionClient(r, (await cookies()).get(STATUS_COOKIE)?.value) : null;
  const s = clientId ? await publicStatus(clientId) : null;
  if (!s) {
    return (
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-locked">
        <h1 className="text-xl font-semibold">Verify to see your status</h1>
        <p className="text-sm text-slate-600">For your privacy, status is shown only after you confirm a one-time code.</p>
        <Link href={`/status?ref=${encodeURIComponent(r)}`} className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">Get a code</Link>
      </section>
    );
  }
  return (
    <>
      <PublicStatusView s={s} />
      <StatusPoller refCode={s.ref} />
    </>
  );
}
