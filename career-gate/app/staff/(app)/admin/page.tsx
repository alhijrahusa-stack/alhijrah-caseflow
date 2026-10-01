import { redirect } from "next/navigation";
import { AdminControl } from "@/components/staff/AdminControl";
import { adminControlData } from "@/lib/admin-control";
import { getStaffSession } from "@/lib/auth";

export const dynamic="force-dynamic";

export default async function AdminPage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error">403 — Management access required.</p>;
  const data=await adminControlData(session);
  return <AdminControl role={session.staff.role} {...data}/>;
}
