import { redirect } from "next/navigation";
import { NewClientForm } from "@/components/staff/NewClientForm";
import { getStaffSession } from "@/lib/auth";

export default async function NewClientPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden">403 — Only admins and managers can create client files.</p>;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New client</h1>
      <NewClientForm />
    </div>
  );
}
