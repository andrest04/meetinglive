import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from './cn';
import { Icon } from './Icon';
import { controlSurface, popupColors, popupItem, popupSurface } from './styles';

export interface Option {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly options: readonly Option[];
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  /** Accessible name of the trigger. */
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  disabled,
  className,
}: SelectProps) {
  return (
    <BaseSelect.Root
      items={options as Option[]}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          controlSurface,
          'flex h-8 min-w-40 items-center justify-between gap-2 pr-2 pl-2.5 select-none',
          className,
        )}
      >
        <BaseSelect.Value
          placeholder={placeholder}
          className="truncate data-placeholder:text-ink-faint"
        />
        <BaseSelect.Icon className="text-ink-muted">
          <Icon icon={ChevronsUpDown} size={14} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-50 outline-none">
          <BaseSelect.Popup
            className={cn(popupSurface, popupColors, 'min-w-[var(--anchor-width)] p-1')}
          >
            <BaseSelect.List className="max-h-[var(--available-height)] overflow-y-auto">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(popupItem, 'grid grid-cols-[14px_1fr] gap-2')}
                >
                  <BaseSelect.ItemIndicator className="col-start-1">
                    <Icon icon={Check} size={14} />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2">{option.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
