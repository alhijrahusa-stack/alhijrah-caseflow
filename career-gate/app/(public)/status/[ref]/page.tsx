import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { StatusLookup } from "./StatusLookup";

export const metadata: Metadata = { title: "Application status" };

export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { ref } = await params;
  const { new: isNew } = await searchParams;
  const refCode = decodeURIComponent(ref).toUpperCase();

  return (
    <div className="space-y-4">
      {isNew && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Application received. Save your reference number: <strong>{refCode}</strong>
        </div>
      )}
      <Card title={`Application ${refCode}`}>
        <StatusLookup refCode={refCode} />
      </Card>
    </div>
  );
}
