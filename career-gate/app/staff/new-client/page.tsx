import { NewClientForm } from "@/components/staff/NewClientForm";

export default function NewClientPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New client</h1>
      <NewClientForm />
    </div>
  );
}
