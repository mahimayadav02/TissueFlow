import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

/** Grey bars in the shape of rows, shown while a list is loading. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-[#E8EEEA]" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

/** What an empty list says: what is missing and, when there is one, what to do about it. */
export function EmptyState({ text, action }: { text: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-forest-50 text-forest-600"><Inbox size={20} /></span>
      <p className="max-w-sm text-sm text-ink-muted">{text}</p>
      {action}
    </div>
  );
}

export function Table<T>({ columns, rows, rowKey, empty = 'Nothing to show yet.' }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; empty?: string }) {
  if (rows.length === 0) return /^loading/i.test(empty) ? <SkeletonRows /> : <EmptyState text={empty} />;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-line bg-paper/60 px-3 py-2.5 text-xs font-semibold text-ink-muted first:rounded-tl-lg last:rounded-tr-lg ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-[#E6ECE8] transition-colors last:border-0 hover:bg-forest-50/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
