import { Skeleton } from '@/components/ui/skeleton';

/**
 * Phase 41: what a page shows while its server data loads (navigation stays instant). Shapes only,
 * no fake text or numbers; announced to screen readers once. The shimmer stops when motion is reduced.
 */
export function PageSkeleton({ cards = 4, rows = 3, wide = false }: { cards?: number; rows?: number; wide?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`mx-auto flex w-full flex-col gap-6 px-4 py-10 sm:px-6 ${wide ? 'max-w-6xl' : 'max-w-5xl'}`}>
      <span className="sr-only">Loading…</span>
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
