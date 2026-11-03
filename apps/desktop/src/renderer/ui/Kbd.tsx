import type { ReactNode } from 'react';
import { cn } from './cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-hairline px-1.5 font-mono text-caption text-ink-muted',
        'forced-colors:border-[CanvasText]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
