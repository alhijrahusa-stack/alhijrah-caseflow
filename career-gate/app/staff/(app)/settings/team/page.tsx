import { StaffText } from "@/components/staff/StaffLanguage";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

export default async function TeamPage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error" data-testid="forbidden"><StaffText en="403 — Admin or manager only." ar="403 — متاح للمسؤول أو المدير فقط."/></p>;
  redirect("/staff/staff?tab=team");
}
