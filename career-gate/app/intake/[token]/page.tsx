import type { Metadata } from "next";
import { ClientIntakeForm } from "@/components/public/ClientIntakeForm";
import { ClientIntakeClosed } from "@/components/public/ClientIntakeClosed";
import { readIntakeLinkForClient } from "@/lib/client-intake-link";

export const dynamic = "force-dynamic";

/**
 * The client's own intake page, opened from a one-time link.
 *
 * Opening or refreshing this page does not consume the link: it only reads
 * whether the link may still be opened. The link is consumed by a successful
 * submission and nothing else.
 *
 * No staff session is required and nothing internal is rendered — no case id,
 * no staff identity, no review, verification or approval state.
 */

export const metadata: Metadata = {
  title: "Career Gate — Client Intake",
  // The URL carries a secret token, so this page must never be indexed.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default async function ClientIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await readIntakeLinkForClient(token);
  if (!link.ok) return <ClientIntakeClosed reason={link.reason} />;
  return <ClientIntakeForm token={token} />;
}
