import { redirect } from "next/navigation";
import { AmazonAccountWorkspace } from "@/components/amazon/AmazonAccountWorkspace";
import { getStaffSession } from "@/lib/auth";

export default async function AmazonAccountPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Famazon-account");
  return <AmazonAccountWorkspace />;
}
