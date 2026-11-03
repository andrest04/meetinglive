import { cn } from './cn';

/** A quiet placeholder with the size of the real thing. Decorative, so hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-quiet-pulse rounded-control bg-hairline forced-colors:border forced-colors:border-[GrayText] forced-colors:bg-transparent',
        className,
      )}
    />
  );
}

/** Lines of text; the last one is shorter, as paragraphs end. Wrap in a busy region with a label. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
