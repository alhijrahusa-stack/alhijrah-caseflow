import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth";

export default async function TeamPage(){
  const session=await getStaffSession();
  if(!session)redirect("/staff/login");
  if(session.staff.role==="staff")return <p className="ops-error" data-testid="forbidden">403 — Admin or manager only.</p>;
  redirect("/staff/staff?tab=team");
}
