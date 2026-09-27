import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading client">
      <Skeleton className="h-8 w-80" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
        <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      </div>
    </div>
  );
}
