import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PublicStatusView } from "@/components/PublicStatusView";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { publicStatus } from "@/lib/public-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exactly what the client sees after verifying at /status (same projection). */
export default async function StatusPreview({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) notFound();
  const s = await publicStatus(id);
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-[640px] space-y-3">
      <p className="text-sm text-slate-500">Preview of the public status page. Clients reach it at /status with their reference and a one-time code.</p>
      <PublicStatusView s={s} />
      <Link href={`/staff/client/${id}`} className="text-sm text-brand-700 hover:underline">← Back to client file</Link>
    </div>
  );
}
