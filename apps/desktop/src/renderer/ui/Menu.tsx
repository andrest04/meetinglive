import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { Kbd } from './Kbd';
import { popupColors, popupItem, popupSeparator, popupSurface } from './styles';

export type MenuEntry =
  | {
      readonly kind?: 'item';
      readonly id: string;
      readonly label: string;
      readonly icon?: LucideIcon;
      /** Display only, for example "Ctrl+R". The caller owns the actual shortcut. */
      readonly shortcut?: string;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }
  | { readonly kind: 'separator'; readonly id: string };

function Entries({
  entries,
  Item,
  Separator,
}: {
  entries: readonly MenuEntry[];
  Item: typeof BaseMenu.Item;
  Separator: typeof BaseMenu.Separator;
}) {
  return entries.map((entry) =>
    entry.kind === 'separator' ? (
      <Separator key={entry.id} className={popupSeparator} />
    ) : (
      <Item
        key={entry.id}
        data-testid={entry.id}
        disabled={entry.disabled}
        onClick={entry.onSelect}
        className={cn(popupItem, 'justify-between')}
      >
        <span className="flex items-center gap-2">
          {entry.icon ? <Icon icon={entry.icon} size={14} className="text-ink-muted" /> : null}
          {entry.label}
        </span>
        {entry.shortcut ? <Kbd>{entry.shortcut}</Kbd> : null}
      </Item>
    ),
  );
}

const popupClass = cn(popupSurface, popupColors, 'min-w-44 p-1');

export interface MenuProps {
  /** The button that opens the menu. It must accept a ref and props. */
  readonly trigger: ReactElement;
  readonly entries: readonly MenuEntry[];
  readonly align?: 'start' | 'center' | 'end';
  /** Which side of the trigger the menu opens on. Default bottom. */
  readonly side?: 'top' | 'bottom' | 'left' | 'right';
  /** Distance kept from the window edge, for a menu inside a small window. */
  readonly collisionPadding?: number;
}

/** Click or Enter/Space/ArrowDown opens; arrows move, type-ahead jumps, Escape returns focus. */
export function Menu({
  trigger,
  entries,
  align = 'start',
  side = 'bottom',
  collisionPadding,
}: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          sideOffset={4}
          side={side}
          align={align}
          {...(collisionPadding === undefined ? {} : { collisionPadding })}
          className="z-50 outline-none"
        >
          <BaseMenu.Popup className={popupClass}>
            <Entries entries={entries} Item={BaseMenu.Item} Separator={BaseMenu.Separator} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface ContextMenuProps {
  readonly entries: readonly MenuEntry[];
  /** The area that answers to right click and the Menu key. */
  readonly children: ReactNode;
  readonly className?: string;
  /** Render the trigger as this element instead of a div, for example an `li` inside a list. */
  readonly render?: ReactElement;
}

export function ContextMenu({ entries, children, className, render }: ContextMenuProps) {
  return (
    <BaseContextMenu.Root>
      <BaseContextMenu.Trigger className={className} render={render}>
        {children}
      </BaseContextMenu.Trigger>
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner className="z-50 outline-none">
          <BaseContextMenu.Popup className={popupClass}>
            <Entries
              entries={entries}
              Item={BaseContextMenu.Item}
              Separator={BaseContextMenu.Separator}
            />
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
