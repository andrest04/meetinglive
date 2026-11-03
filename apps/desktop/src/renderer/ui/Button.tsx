import { Button as BaseButton } from '@base-ui/react/button';
import type { ComponentProps } from 'react';
import { Tooltip } from './Tooltip';
import { cn } from './cn';
import { Icon, type IconProps } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';
export type ButtonSize = 'sm' | 'md';

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-ink bg-ink text-on-ink hover:not-data-disabled:opacity-85 active:not-data-disabled:opacity-70',
  secondary:
    'border-border-control bg-paper text-ink hover:not-data-disabled:bg-hover active:not-data-disabled:bg-pressed',
  quiet:
    'border-transparent bg-transparent text-ink hover:not-data-disabled:bg-hover active:not-data-disabled:bg-pressed',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-ui',
  md: 'h-8 gap-2 px-3 text-ui-lg',
};

const base =
  'inline-flex shrink-0 items-center justify-center rounded-control border font-medium whitespace-nowrap select-none ' +
  'transition-[background-color,opacity] duration-150 ease-out-quick data-disabled:cursor-not-allowed data-disabled:opacity-50 ' +
  'forced-colors:data-disabled:border-[GrayText] forced-colors:data-disabled:text-[GrayText]';

export interface ButtonProps extends Omit<ComponentProps<typeof BaseButton>, 'className'> {
  readonly className?: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Optional leading glyph. */
  readonly icon?: IconProps['icon'];
}

/** There is no danger variant: destructive actions are confirmed in a dialog with plain words. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <BaseButton
      type="button"
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {icon ? <Icon icon={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </BaseButton>
  );
}

export interface IconButtonProps extends Omit<
  ComponentProps<typeof BaseButton>,
  'aria-label' | 'children' | 'className'
> {
  readonly className?: string;
  /** Accessible name, also the tooltip text. Required: an icon alone names nothing. */
  readonly label: string;
  readonly icon: IconProps['icon'];
  readonly variant?: 'secondary' | 'quiet';
  readonly size?: ButtonSize;
  /** Set false where a tooltip would be redundant or inside another floating layer. */
  readonly tooltip?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = 'quiet',
  size = 'md',
  tooltip = true,
  className,
  ...rest
}: IconButtonProps) {
  const button = (
    <BaseButton
      type="button"
      aria-label={label}
      className={cn(base, variants[variant], size === 'sm' ? 'size-7' : 'size-8', className)}
      {...rest}
    >
      <Icon icon={icon} size={size === 'sm' ? 14 : 16} />
    </BaseButton>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
