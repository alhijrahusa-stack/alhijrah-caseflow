import type { Metadata } from "next";
import Link from "next/link";
import { PublicStatusView } from "@/components/PublicStatusView";
import { StatusPoller } from "@/components/StatusPoller";
import { publicStatusByIdentifier } from "@/lib/public-status";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StatusPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const r = decodeURIComponent(ref).trim();
  const s = await publicStatusByIdentifier(r);
  if (!s) {
    return (
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-6" data-testid="status-not-found">
        <h1 className="text-xl font-semibold">File not found</h1>
        <p className="text-sm text-slate-600">Check the file number and try again.</p>
        <Link href="/status" className="inline-flex rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">Search status</Link>
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
