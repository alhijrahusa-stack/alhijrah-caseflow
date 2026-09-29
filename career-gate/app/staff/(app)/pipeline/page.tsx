import { redirect } from "next/navigation";
import { PipelineBoard } from "@/components/staff/PipelineBoard";
import { getStaffSession } from "@/lib/auth";
import { pipelineData } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const data = await pipelineData(session);
  return <PipelineBoard stages={data.stages} clients={data.clients} />;
}
