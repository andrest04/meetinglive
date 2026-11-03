import { Input as BaseInput } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { controlSurface } from './styles';

type InputProps = Omit<ComponentProps<typeof BaseInput>, 'className'> & {
  readonly className?: string;
};

export function Input({ className, ...rest }: InputProps) {
  return <BaseInput className={cn(controlSurface, 'h-8 px-2.5', className)} {...rest} />;
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
