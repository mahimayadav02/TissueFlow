import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from './cn';

const box = 'focus-ring w-full rounded-lg border border-[#C6BFB0] bg-[#FBFAF7] px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-muted/60';

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {error ? <span className="text-xs text-redx-700">{error}</span> : hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(box, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(box, className)} {...rest}>{children}</select>;
}
