import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export function Table<T>({ columns, rows, rowKey, empty = 'Nothing to show yet.' }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; empty?: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`border-b border-line px-2 py-2 text-xs font-semibold text-ink-muted ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-[#EEEAE1] last:border-0">
              {columns.map((c) => (
                <td key={c.key} className={`px-2 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
