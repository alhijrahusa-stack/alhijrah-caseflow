import { StaffText } from "@/components/staff/StaffLanguage";
import { redirect } from "next/navigation";
import { NewClientForm } from "@/components/staff/NewClientForm";
import { getStaffSession } from "@/lib/auth";

export default async function NewClientPage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role === "staff") {
    return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="forbidden"><StaffText en="403 — Only admins and managers can create client files." ar="403 — إنشاء ملفات العملاء متاح للمسؤولين والمديرين فقط."/></p>;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold"><StaffText en="New client" ar="إضافة عميل"/></h1>
      <NewClientForm />
    </div>
  );
}
