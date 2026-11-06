import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { clampSize, sizeForDrag, sizeForKey, type FixedPane } from './splitter-logic';

export interface SplitterProps {
  /** First pane (left, or top when vertical). */
  readonly first: ReactNode;
  /** Second pane (right, or bottom when vertical). */
  readonly second: ReactNode;
  /** Which pane keeps the fixed size; the other one takes the rest. Default `start` (the first). */
  readonly fixedPane?: FixedPane;
  /** Size restored by a double click on the handle. */
  readonly defaultSize: number;
  /** Size at mount, for example a remembered one. Defaults to `defaultSize`. */
  readonly initialSize?: number;
  /**
   * The fixed pane leaves the layout: no handle and no size. Its content stays mounted and
   * decides itself whether to hide or float, so the other pane never remounts.
   */
  readonly collapsed?: boolean;
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
  fixedPane = 'start',
  defaultSize,
  initialSize,
  collapsed = false,
  minSize,
  maxSize,
  orientation = 'horizontal',
  label,
  onSizeChange,
  className,
}: SplitterProps) {
  const fixedId = useId();
  const [size, setSize] = useState(() => clampSize(initialSize ?? defaultSize, minSize, maxSize));
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
      fixedPane,
    });
    if (next === null) return;
    event.preventDefault();
    update(next);
  };

  const fixed = (content: ReactNode): ReactNode => (
    <div
      id={fixedId}
      style={collapsed ? undefined : horizontal ? { width: size } : { height: size }}
      className={collapsed ? 'contents' : 'flex min-h-0 min-w-0 shrink-0 flex-col'}
    >
      {content}
    </div>
  );
  const fluid = (content: ReactNode): ReactNode => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{content}</div>
  );

  return (
    <div
      className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col', className)}
    >
      {fixedPane === 'start' ? fixed(first) : fluid(first)}
      {collapsed ? null : (
        <div
          role="separator"
          tabIndex={0}
          aria-label={label}
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-controls={fixedId}
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
                fixedPane,
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
            // Above both panes, so the wider hit area on either side of the line stays grabbable.
            'app-no-drag group relative z-10 shrink-0 touch-none bg-hairline outline-none',
            horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
            'before:absolute before:content-[""]',
            horizontal
              ? 'before:inset-y-0 before:-inset-x-1'
              : 'before:inset-x-0 before:-inset-y-1',
            'after:absolute after:bg-ink after:opacity-0 after:transition-opacity after:duration-150 after:content-[""]',
            horizontal ? 'after:inset-y-0 after:-inset-x-px' : 'after:inset-x-0 after:-inset-y-px',
            'hover:after:opacity-100 focus-visible:after:opacity-100 data-dragging:after:opacity-100',
            'forced-colors:bg-[CanvasText]',
          )}
        />
      )}
      {fixedPane === 'start' ? fluid(second) : fixed(second)}
    </div>
  );
}
