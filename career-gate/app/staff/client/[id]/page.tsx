import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ClientFile, type ClientFileData } from "@/components/staff/ClientFile";
import { clientFile } from "@/lib/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upload_failed?: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await clientFile(id);
  if (!data) notFound();
  const { upload_failed } = await searchParams;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const statusUrl = `${proto}://${host}/status/${data.client.ref}?t=${data.client.status_token}`;
  return <ClientFile data={JSON.parse(JSON.stringify(data)) as ClientFileData} statusUrl={statusUrl} uploadFailed={upload_failed?.slice(0, 500)} />;
}
