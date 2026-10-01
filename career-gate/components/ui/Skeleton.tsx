export function Skeleton({ className = "" }: { className?: string }) {
  return <div data-skeleton="true" className={`animate-pulse rounded-xl ${className}`} aria-hidden="true" />;
}

export function PageSkeleton({ cards = 0, rows = 6 }: { cards?: number; rows?: number }) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-9 w-64 max-w-[70vw]" />
      {cards > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: cards }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      <div className="staff-glass rounded-2xl p-4">
        <div className="mb-3 grid grid-cols-4 gap-3">
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </div>
    </div>
  );
}
