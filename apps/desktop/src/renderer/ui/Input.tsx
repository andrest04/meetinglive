import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { controlSurface } from './styles';

type InputProps = Omit<ComponentProps<typeof BaseInput>, 'className'> & {
  readonly className?: string;
};

/** A field that reads as the document's title: no box at rest, an edge on hover and focus. */
const titleSurface =
  'h-12 min-w-0 truncate rounded-control border border-transparent bg-transparent px-2 ' +
  'text-title font-semibold tracking-[-0.02em] text-ink placeholder:text-ink-faint ' +
  'transition-colors duration-150 ease-out-quick hover:not-disabled:border-hairline ' +
  'focus:border-border-control disabled:cursor-not-allowed disabled:opacity-60';

export function Input({
  className,
  appearance = 'control',
  ...rest
}: InputProps & { readonly appearance?: 'control' | 'title' }) {
  const surface = appearance === 'title' ? titleSurface : cn(controlSurface, 'h-8 px-2.5');
  return <BaseInput className={cn(surface, className)} {...rest} />;
}

export function Textarea({
  className,
  rows = 4,
  ...rest
}: Omit<InputProps, 'render'> & { readonly rows?: number }) {
  return (
    <BaseInput
      render={<textarea rows={rows} />}
      className={cn(
        controlSurface,
        'min-h-16 resize-y px-2.5 py-1.5 text-read leading-6',
        className,
      )}
      {...rest}
    />
  );
}
