import { redirect } from "next/navigation";
import { StaffWorkspace } from "@/components/staff/StaffWorkspace";
import { getStaffSession } from "@/lib/auth";
import { staffWorkspaceData } from "@/lib/workspace";

export const dynamic="force-dynamic";

export default async function WorkspacePage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  return <StaffWorkspace data={await staffWorkspaceData(session)}/>;
}
