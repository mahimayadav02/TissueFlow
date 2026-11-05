import { Table } from '../ui';
import type { BoardRow } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { AttBadge, Progress } from './bits';

/** One row per operator: attendance, work given, target, done, lost, entries still to check. */
export function BoardTable({ rows, loading, showZone }: { rows: BoardRow[]; loading: boolean; showZone: boolean }) {
  return (
    <Table<BoardRow>
      rowKey={(r) => r.operatorId}
      rows={rows}
      empty={loading ? 'Loading…' : 'No operators in these zones.'}
      columns={[
        { key: 'n', header: 'Operator', render: (r) => <div><div className="font-semibold">{r.fullName}</div>{showZone && <div className="text-xs text-ink-muted">{r.areaName}</div>}</div> },
        { key: 'a', header: 'Attendance', render: (r) => <AttBadge status={r.attendance} /> },
        { key: 'w', header: 'Work given', render: (r) => (r.work.length ? <span className="text-[13px]">{r.work.join(', ')}</span> : <span className="text-ink-muted">—</span>) },
        { key: 't', header: 'Target', align: 'right', render: (r) => (r.target ? fmt(r.target) : '—') },
        { key: 'h', header: 'Handled', align: 'right', render: (r) => fmt(r.handled) },
        { key: 'p', header: 'Achieved', render: (r) => <Progress pct={r.pct} level={r.level} compact /> },
        { key: 'o', header: 'New bottles', align: 'right', render: (r) => fmt(r.produced) },
        { key: 'l', header: 'Lost', align: 'right', render: (r) => (r.lost ? <span className="text-redx-700">{r.lost}</span> : 0) },
        { key: 'c', header: 'To check', align: 'right', render: (r) => (r.pending ? <span className="font-semibold text-amberx-700">{r.pending}</span> : 0) },
      ]}
    />
  );
}
