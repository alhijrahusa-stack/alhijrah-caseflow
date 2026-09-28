import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PublicStatusView } from "@/components/PublicStatusView";
import { StatusPoller } from "@/components/StatusPoller";
import { publicStatus } from "@/lib/public-status";
import { sessionClient, STATUS_COOKIE } from "@/lib/status-access";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StatusPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const r = decodeURIComponent(ref).trim();
  const token = (await cookies()).get(STATUS_COOKIE)?.value;
  const clientId = await sessionClient(r, token);
  if (!clientId) redirect(`/status?ref=${encodeURIComponent(r)}`);
  const status = await publicStatus(clientId);
  if (!status) redirect("/status");

  return (
    <>
      <PublicStatusView s={status} />
      <StatusPoller refCode={status.ref} />
    </>
  );
}
