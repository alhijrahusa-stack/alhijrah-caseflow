import { notFound, redirect } from "next/navigation";
import { EditClientForm } from "@/components/staff/EditClientForm";
import { getStaffSession } from "@/lib/auth";
import { clientScope } from "@/lib/authz";
import { clientFile } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const scope = await clientScope(session, id);
  if (!scope.ok) {
    if (scope.status === 403) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — This client is not assigned to you.</p>;
    notFound();
  }
  const data = await clientFile(session, id);
  if (!data) notFound();
  const plain = JSON.parse(JSON.stringify(data));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit {plain.client.full_name} <span className="font-mono text-base text-slate-500">{plain.client.ref}</span></h1>
      <EditClientForm client={plain.client} employment={plain.employment} preferences={plain.preferences} />
    </div>
  );
}
