import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-forest-700 text-white hover:bg-forest-600 disabled:bg-forest-700/50',
  secondary: 'bg-white text-forest-700 border border-forest-700 hover:bg-forest-50',
  ghost: 'text-ink hover:bg-black/5',
  danger: 'bg-redx-700 text-white hover:opacity-90',
};

export function Button({ variant = 'primary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn('focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed', styles[variant], className)}
      {...rest}
    />
  );
}
