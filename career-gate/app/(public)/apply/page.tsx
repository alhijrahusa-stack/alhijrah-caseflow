import type { Metadata } from "next";
import { IntakeWizard } from "@/components/intake/IntakeWizard";

export const metadata: Metadata = { title: "Apply" };

export default function ApplyPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Employment request</h1>
      <IntakeWizard />
    </>
  );
}
