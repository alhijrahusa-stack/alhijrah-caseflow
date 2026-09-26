import { notFound } from "next/navigation";
import { EditClientForm } from "@/components/staff/EditClientForm";
import { clientFile } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await clientFile(id);
  if (!data) notFound();
  const plain = JSON.parse(JSON.stringify(data));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit {plain.client.full_name} <span className="font-mono text-base text-slate-500">{plain.client.ref}</span></h1>
      <EditClientForm client={plain.client} employment={plain.employment} preferences={plain.preferences} />
    </div>
  );
}
