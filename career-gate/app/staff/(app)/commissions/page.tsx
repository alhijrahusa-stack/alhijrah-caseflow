import { redirect } from "next/navigation";
import { CommissionsBoard } from "@/components/staff/CommissionsBoard";
import { adminControlData } from "@/lib/admin-control";
import { getStaffSession } from "@/lib/auth";
import { commissionData } from "@/lib/commissions";

export const dynamic="force-dynamic";

export default async function CommissionsPage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  const [data,admin]=await Promise.all([
    commissionData(session),
    session.staff.role==="admin"?adminControlData(session):Promise.resolve(null),
  ]);
  return <CommissionsBoard role={session.staff.role} rules={data.rules} commissions={data.commissions} staff={admin?.staff??[]}/>;
}
