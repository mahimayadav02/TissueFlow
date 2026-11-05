import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/** Small square button for row actions (edit, delete). Always give it a label. */
export function IconButton({ label, children, tone = 'default', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; tone?: 'default' | 'danger' }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn('focus-ring rounded-lg p-1.5', tone === 'danger' ? 'text-redx-700 hover:bg-redx-100' : 'text-ink-muted hover:bg-black/5 hover:text-ink', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
