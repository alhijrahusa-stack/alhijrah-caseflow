import { redirect } from "next/navigation";

export default function DistributionPage(){
  redirect("/staff/staff?tab=assignments");
}
