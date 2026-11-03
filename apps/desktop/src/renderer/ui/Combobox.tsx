import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from './cn';
import { Icon } from './Icon';
import type { Option } from './Select';
import { controlSurface, popupColors, popupItem, popupSurface } from './styles';

export interface ComboboxProps {
  readonly options: readonly Option[];
  readonly value: string | null;
  readonly onValueChange: (value: string | null) => void;
  readonly label: string;
  readonly placeholder?: string;
  /** Shown when the typed text matches nothing. */
  readonly emptyText: string;
  readonly clearLabel: string;
  readonly openLabel: string;
  readonly className?: string;
}

/** Type to filter, arrows to move, Enter to choose. The list is the options given, nothing is created. */
export function Combobox({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  emptyText,
  clearLabel,
  openLabel,
  className,
}: ComboboxProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <BaseCombobox.Root
      items={options as Option[]}
      value={selected}
      onValueChange={(next: Option | null) => {
        onValueChange(next ? next.value : null);
      }}
    >
      <BaseCombobox.InputGroup
        className={cn(
          controlSurface,
          'relative flex h-8 min-w-56 items-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink',
          className,
        )}
      >
        <BaseCombobox.Input
          aria-label={label}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent pr-1 pl-2.5 text-ui-lg outline-none placeholder:text-ink-faint"
        />
        <BaseCombobox.Clear
          aria-label={clearLabel}
          className="flex size-7 items-center justify-center rounded-control text-ink-muted hover:bg-hover"
        >
          <Icon icon={X} size={14} />
        </BaseCombobox.Clear>
        <BaseCombobox.Trigger
          aria-label={openLabel}
          className="flex size-7 items-center justify-center rounded-control text-ink-muted hover:bg-hover"
        >
          <Icon icon={ChevronDown} size={14} />
        </BaseCombobox.Trigger>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="z-50 outline-none">
          <BaseCombobox.Popup
            className={cn(popupSurface, popupColors, 'w-[var(--anchor-width)] min-w-56 p-1')}
          >
            <BaseCombobox.Empty className="px-2 py-2 text-ui text-ink-muted empty:hidden">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-64 overflow-y-auto outline-none">
              {(item: Option) => (
                <BaseCombobox.Item
                  key={item.value}
                  value={item}
                  className={cn(popupItem, 'grid grid-cols-[14px_1fr] gap-2')}
                >
                  <BaseCombobox.ItemIndicator className="col-start-1">
                    <Icon icon={Check} size={14} />
                  </BaseCombobox.ItemIndicator>
                  <span className="col-start-2">{item.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
