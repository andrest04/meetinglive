import type { LucideIcon } from 'lucide-react';
import { cn } from './cn';

/** The one icon treatment: lucide, 1.5 stroke, decorative unless the parent names it. */
export const ICON_STROKE = 1.5;

export interface IconProps {
  readonly icon: LucideIcon;
  readonly size?: 12 | 14 | 16 | 20;
  readonly className?: string;
}

export function Icon({ icon: Glyph, size = 16, className }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={ICON_STROKE}
      nonScalingStroke
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
    />
  );
}
