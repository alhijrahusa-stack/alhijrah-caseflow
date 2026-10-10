import { notFound, redirect } from "next/navigation";
import { GateJobAccountCard, type GateJobAccountCardData } from "@/components/gate-job-account/GateJobAccountCard";
import { ClientFile, type ClientFileData, type ClientPanel, type ClientTab } from "@/components/staff/ClientFile";
import { NextActionCard } from "@/components/staff/NextActionCard";
import { RequirementsPanel } from "@/components/staff/RequirementsPanel";
import { getGateJobAccountForClient } from "@/lib/gate-job-account/service";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { clientAccountSummary } from "@/lib/client-account";
import { clientNextAction } from "@/lib/next-action";
import { clientFile } from "@/lib/queries";
import { clientRequirements } from "@/lib/requirements";
import { securityEvent } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PANELS = new Set<ClientPanel>(["document", "appointment", "note", "task", "contacted", "status", "next_step", "followup", "assign"]);
const TABS = new Set<ClientTab>(["profile", "preferences", "documents", "appointments", "work", "activity"]);

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ action?: string; tab?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) {
    if (scope.status === 403) {
      await securityEvent({ event: "access_denied", staffId: session.staff.id, route: `/staff/client/${id}`, detail: { client_id: id } });
      return <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-6" data-testid="forbidden"><h1 className="text-lg font-semibold text-red-300">403 — Not permitted</h1><p className="text-sm text-red-400">This client is not assigned to you.</p></div>;
    }
    notFound();
  }
  const [data, account, gateJobAccount, requirementData, nextAction, query] = await Promise.all([
    clientFile(session, id),
    clientAccountSummary(session, id),
    getGateJobAccountForClient(session, id),
    clientRequirements(session, id),
    clientNextAction(session, id),
    searchParams,
  ]);
  if (!data) notFound();
  const requestedPanel = query.action as ClientPanel | undefined;
  const initialPanel = requestedPanel && PANELS.has(requestedPanel) ? requestedPanel : null;
  const requestedTab = query.tab as ClientTab | undefined;
  const initialTab = requestedTab && TABS.has(requestedTab) ? requestedTab : null;
  const gateJob = gateJobAccount ? JSON.parse(JSON.stringify(gateJobAccount)) as GateJobAccountCardData : null;
  return (
    <div className="space-y-4">
      {nextAction && <NextActionCard action={nextAction} />}
      <ClientFile data={JSON.parse(JSON.stringify(data)) as ClientFileData} account={account} initialPanel={initialPanel} initialTab={initialTab} />
      <GateJobAccountCard account={gateJob} />
      <RequirementsPanel clientId={id} rows={JSON.parse(JSON.stringify(requirementData.requirements))} readiness={requirementData.readiness} postHire={JSON.parse(JSON.stringify(data.postHire))} startDate={data.client.start_date ? String(data.client.start_date) : null} />
    </div>
  );
}
