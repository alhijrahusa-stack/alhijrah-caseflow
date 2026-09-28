import { notFound, redirect } from "next/navigation";
import { ClientFile, type ClientFileData, type ClientPanel } from "@/components/staff/ClientFile";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { clientFile } from "@/lib/queries";
import { securityEvent } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PANELS = new Set<ClientPanel>(["document", "appointment", "note", "task", "contacted", "status", "next_step", "followup", "assign"]);

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) {
    if (scope.status === 403) {
      await securityEvent({ event: "access_denied", staffId: session.staff.id, route: `/staff/client/${id}`, detail: { client_id: id } });
      return (
        <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-6" data-testid="forbidden">
          <h1 className="text-lg font-semibold text-red-300">403 — Not permitted</h1>
          <p className="text-sm text-red-400">This client is not assigned to you.</p>
        </div>
      );
    }
    notFound();
  }
  const data = await clientFile(session, id);
  if (!data) notFound();
  const requested = (await searchParams).action as ClientPanel | undefined;
  const initialPanel = requested && PANELS.has(requested) ? requested : null;
  return <ClientFile data={JSON.parse(JSON.stringify(data)) as ClientFileData} initialPanel={initialPanel} />;
}
