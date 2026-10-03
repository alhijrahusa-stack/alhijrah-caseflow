import { redirect } from "next/navigation";
import { AmazonQuickAdd } from "@/components/amazon/AmazonQuickAdd";
import { getStaffSession } from "@/lib/auth";

export default async function AmazonQuickAddPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login?next=%2Fstaff%2Famazon-account%2Fquick-add");
  return <AmazonQuickAdd />;
}
