import type { ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'grey';

const tones: Record<Tone, string> = {
  green: 'bg-forest-100 text-[#14532D]',
  amber: 'bg-amberx-100 text-amberx-700',
  red: 'bg-redx-100 text-redx-700',
  blue: 'bg-bluex-100 text-bluex-700',
  purple: 'bg-purplex-100 text-purplex-700',
  grey: 'bg-black/5 text-ink-muted',
};

export function Badge({ tone = 'grey', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', tones[tone], className)}>{children}</span>;
}
