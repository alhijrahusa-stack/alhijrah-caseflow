import { notFound, redirect } from "next/navigation";
import { ClientFile, type ClientFileData } from "@/components/staff/ClientFile";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { clientFile } from "@/lib/queries";
import { securityEvent } from "@/lib/ratelimit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) {
    if (scope.status === 403) {
      await securityEvent({ event: "access_denied", staffId: session.staff.id, route: `/staff/client/${id}`, detail: { client_id: id } });
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6" data-testid="forbidden">
          <h1 className="text-lg font-semibold text-red-800">403 — Not permitted</h1>
          <p className="text-sm text-red-700">This client is not assigned to you.</p>
        </div>
      );
    }
    notFound();
  }
  const data = await clientFile(session, id);
  if (!data) notFound();
  return <ClientFile data={JSON.parse(JSON.stringify(data)) as ClientFileData} />;
}
