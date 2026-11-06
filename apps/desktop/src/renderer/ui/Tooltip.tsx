import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';
import { popupSurface } from './styles';
import { cn } from './cn';

/** Wrap the app once so tooltips share their open delay. */
export const TooltipProvider = BaseTooltip.Provider;

export interface TooltipProps {
  readonly content: ReactNode;
  /** The element that triggers it. It must accept a ref and props. */
  readonly children: ReactElement;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Tooltip({ content, children, side = 'bottom' }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        {/* z-50 like menus: a floating AI panel (z-30) must not cover its own tooltips. */}
        <BaseTooltip.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-50">
          <BaseTooltip.Popup
            className={cn(
              popupSurface,
              'max-w-80 border-ink bg-ink px-2 py-1 text-ui text-pretty text-on-ink',
            )}
          >
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
