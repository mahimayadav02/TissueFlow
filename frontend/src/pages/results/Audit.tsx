import { useState } from 'react';
import { Card, ErrorText, Input, PageHeader, Select, Table } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { AuditRow } from '../../lib/resultsApi';
import { useLoad } from '../../lib/useLoad';

/** Who changed what and when, for the last 30 days. Manager only. */
export default function Audit() {
  const { user } = useAuth();
  const { data, error } = useLoad(() => (user ? api.listAudit(user) : Promise.resolve([])), [user]);
  const [who, setWho] = useState('');
  const [action, setAction] = useState('');
  const [text, setText] = useState('');
  const rows = (data ?? []).filter((a) => (!who || a.userName === who) && (!action || a.action === action) && (!text || `${a.action} ${a.detail}`.toLowerCase().includes(text.toLowerCase())));
  const users = [...new Set((data ?? []).map((a) => a.userName))].sort();
  const actions = [...new Set((data ?? []).map((a) => a.action))].sort();

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change made in the app: who, what and when. Entries cannot be edited or deleted." />
      <ErrorText>{error}</ErrorText>
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="w-auto" aria-label="Person">
            <option value="">Everyone</option>
            {users.map((u) => <option key={u}>{u}</option>)}
          </Select>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto" aria-label="Action">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a}>{a}</option>)}
          </Select>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search, e.g. B1-26" className="sm:max-w-xs" aria-label="Search" />
        </div>
        <Table<AuditRow>
          rowKey={(a) => a.auditId}
          rows={rows}
          empty={data ? 'Nothing recorded yet. Changes made from now on appear here.' : 'Loading…'}
          columns={[
            { key: 't', header: 'When', render: (a) => <span className="whitespace-nowrap">{new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> },
            { key: 'u', header: 'Who', render: (a) => a.userName },
            { key: 'a', header: 'What', render: (a) => <span className="font-semibold">{a.action}</span> },
            { key: 'd', header: 'Details', render: (a) => <span className="text-[13px] text-ink-muted">{a.detail || '—'}</span> },
          ]}
        />
        <p className="mt-3 text-xs text-ink-muted">With the backend, the server writes this log, so it also covers changes made outside the app.</p>
      </Card>
    </>
  );
}
