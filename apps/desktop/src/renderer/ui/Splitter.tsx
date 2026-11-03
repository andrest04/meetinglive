import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { clampSize, sizeForDrag, sizeForKey } from './splitter-logic';

export interface SplitterProps {
  /** First pane (left, or top when vertical). It has the fixed size; the second pane takes the rest. */
  readonly first: ReactNode;
  readonly second: ReactNode;
  readonly defaultSize: number;
  readonly minSize: number;
  readonly maxSize: number;
  readonly orientation?: 'horizontal' | 'vertical';
  /** Accessible name of the handle, for example "Resize navigation pane". */
  readonly label: string;
  readonly onSizeChange?: (size: number) => void;
  readonly className?: string;
}

/**
 * Two panes and a handle. Drag it, focus it and use the arrow keys (Shift for bigger steps,
 * Home and End for the limits), or double click to restore the default size.
 */
export function Splitter({
  first,
  second,
  defaultSize,
  minSize,
  maxSize,
  orientation = 'horizontal',
  label,
  onSizeChange,
  className,
}: SplitterProps) {
  const firstId = useId();
  const [size, setSize] = useState(() => clampSize(defaultSize, minSize, maxSize));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startSize: number; startPointer: number } | null>(null);
  const horizontal = orientation === 'horizontal';

  const update = (next: number): void => {
    if (next === size) return;
    setSize(next);
    onSizeChange?.(next);
  };

  const pointerOf = (event: PointerEvent): number => (horizontal ? event.clientX : event.clientY);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = sizeForKey(event.key, event.shiftKey, size, {
      min: minSize,
      max: maxSize,
      orientation,
    });
    if (next === null) return;
    event.preventDefault();
    update(next);
  };

  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col', className)}
    >
      <div
        id={firstId}
        style={horizontal ? { width: size } : { height: size }}
        className="flex min-h-0 min-w-0 shrink-0 flex-col"
      >
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-controls={firstId}
        aria-valuenow={size}
        aria-valuemin={minSize}
        aria-valuemax={Math.max(minSize, maxSize)}
        data-dragging={dragging || undefined}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          update(clampSize(defaultSize, minSize, maxSize));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startSize: size, startPointer: pointerOf(event) };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          update(
            sizeForDrag(drag.current.startSize, drag.current.startPointer, pointerOf(event), {
              min: minSize,
              max: maxSize,
            }),
          );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        className={cn(
          'app-no-drag group relative shrink-0 touch-none bg-hairline outline-none',
          horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
          'before:absolute before:content-[""]',
          horizontal ? 'before:inset-y-0 before:-inset-x-1' : 'before:inset-x-0 before:-inset-y-1',
          'after:absolute after:bg-ink after:opacity-0 after:transition-opacity after:duration-150 after:content-[""]',
          horizontal ? 'after:inset-y-0 after:-inset-x-px' : 'after:inset-x-0 after:-inset-y-px',
          'hover:after:opacity-100 focus-visible:after:opacity-100 data-dragging:after:opacity-100',
          'forced-colors:bg-[CanvasText]',
        )}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{second}</div>
    </div>
  );
}
