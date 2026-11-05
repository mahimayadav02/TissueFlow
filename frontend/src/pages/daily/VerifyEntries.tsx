import { useState, type FormEvent } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { EntryBadge } from '../../components/daily/bits';
import { StageBadge } from '../../components/production/badges';
import { Badge, Button, Card, ErrorText, Field, FormActions, Input, Modal, PageHeader, Table, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { addDays, today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { EntryRow } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';

type Tab = 'pending' | 'done';

/** Growth this round, and whether the numbers look unusual enough to check by hand. */
const growth = (e: EntryRow) => (e.bottlesHandled - e.bottlesLost > 0 ? e.bottlesProduced / (e.bottlesHandled - e.bottlesLost) : 0);
function flags(e: EntryRow): string[] {
  const f: string[] = [];
  const g = growth(e);
  if (e.stageCode.startsWith('M') && (g > 4 || g < 1)) f.push(`growth × ${g.toFixed(1)}`);
  if (e.bottlesHandled && e.bottlesLost / e.bottlesHandled > 0.2) f.push('high loss');
  if (e.unassigned) f.push('not in work given');
  return f;
}
const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Supervisor checks each tray an operator entered: verify it, or send it back with a reason. */
export default function VerifyEntries() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('pending');
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.listEntries(user, { status: 'PENDING' }), api.listEntries(user, { from: addDays(today(), -7) })]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  const [picked, setPicked] = useState<number[]>([]);
  const [rejecting, setRejecting] = useState<EntryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [msg, setMsg] = useState('');

  const [pending, recent] = data ?? [[], []];
  const done = recent.filter((e) => e.status !== 'PENDING');
  const toggle = (id: number) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const allPicked = pending.length > 0 && picked.length === pending.length;

  const verify = async (ids: number[]) => {
    if (!user) return;
    setBusy(true);
    setActionError('');
    setMsg('');
    try {
      await api.verifyEntries(ids, user);
      setMsg(`${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} verified.`);
      setPicked([]);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not verify.');
    } finally {
      setBusy(false);
    }
  };

  const bottlesCol = {
    key: 'n', header: 'Bottles: in → new', align: 'right' as const,
    render: (e: EntryRow) => <span className="tabular-nums">{e.bottlesHandled} → <b>{fmt(e.bottlesProduced)}</b> <span className="text-xs text-ink-muted">(× {growth(e).toFixed(1)})</span></span>,
  };

  return (
    <>
      <PageHeader title="Check entries" subtitle="Every tray an operator sub-cultures waits here. Verified entries count in reports; a sent-back entry is undone if its new trays have not been touched." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'pending', label: `To check (${pending.length})` }, { id: 'done', label: 'Checked, last 7 days' }]} />
      <ErrorText>{error || actionError}</ErrorText>
      {msg && <p className="mb-4 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700">{msg}</p>}

      {tab === 'pending' ? (
        <Card
          title={pending.length ? `${pending.length} waiting · ${fmt(pending.reduce((n, e) => n + e.bottlesHandled, 0))} bottles` : 'Nothing waiting'}
          action={pending.length > 0 && (
            <Button onClick={() => verify(picked)} disabled={busy || !picked.length}><Check size={16} /> Verify {picked.length || ''} selected</Button>
          )}
        >
          <Table<EntryRow>
            rowKey={(e) => e.entryId}
            rows={pending}
            empty={data ? 'All entries are checked.' : 'Loading…'}
            columns={[
              {
                key: 'p', header: '', render: (e) => <input type="checkbox" aria-label={`Select entry ${e.qrCode}`} checked={picked.includes(e.entryId)} onChange={() => toggle(e.entryId)} />,
              },
              { key: 'o', header: 'Operator', render: (e) => <div><div className="font-semibold">{e.operatorName}</div><div className="text-xs text-ink-muted">{time(e.enteredAt)}</div></div> },
              { key: 't', header: 'Tray', render: (e) => <span className="font-mono text-[13px]">{e.qrCode}</span> },
              { key: 's', header: 'Stage', render: (e) => <span className="flex items-center gap-1.5">{e.batchCode} <StageBadge code={e.stageCode} /></span> },
              bottlesCol,
              { key: 'l', header: 'Lost', align: 'right', render: (e) => (e.bottlesLost ? <span className="text-redx-700">{e.bottlesLost}</span> : 0) },
              { key: 'f', header: 'Look at', render: (e) => <div className="flex flex-wrap gap-1">{flags(e).map((f) => <Badge key={f} tone="amber">{f}</Badge>)}</div> },
              {
                key: 'a', header: '', render: (e) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="min-h-[36px] px-2.5" onClick={() => verify([e.entryId])} disabled={busy}><Check size={15} /> Verify</Button>
                    <Button variant="ghost" className="min-h-[36px] px-2.5 text-redx-700" onClick={() => setRejecting(e)} disabled={busy}><Undo2 size={15} /> Send back</Button>
                  </div>
                ),
              },
            ]}
          />
          {pending.length > 1 && (
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : pending.map((e) => e.entryId))} /> Select all
            </label>
          )}
        </Card>
      ) : (
        <Card title={`${done.length} checked`}>
          <Table<EntryRow>
            rowKey={(e) => e.entryId}
            rows={done}
            empty={data ? 'Nothing checked in the last 7 days.' : 'Loading…'}
            columns={[
              { key: 'd', header: 'Day', render: (e) => new Date(e.workDate + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) },
              { key: 'o', header: 'Operator', render: (e) => e.operatorName },
              { key: 't', header: 'Tray', render: (e) => <span className="font-mono text-[13px]">{e.qrCode}</span> },
              { key: 's', header: 'Stage', render: (e) => <span className="flex items-center gap-1.5">{e.batchCode} <StageBadge code={e.stageCode} /></span> },
              bottlesCol,
              { key: 'st', header: 'Result', render: (e) => <div><EntryBadge status={e.status} />{e.note && <div className="mt-1 text-xs text-ink-muted">“{e.note}”</div>}</div> },
              { key: 'b', header: 'Checked by', render: (e) => <span className="text-ink-muted">{e.verifiedByName ?? '—'}</span> },
            ]}
          />
        </Card>
      )}

      {rejecting && <RejectForm entry={rejecting} onClose={() => setRejecting(null)} onDone={(undone) => { setMsg(undone ? 'Sent back. The sub-culture was undone: the new trays were removed and the old tray is active again. Throw away the new labels.' : 'Sent back. The tray records were not changed (the new trays are already in use); correct them on the Trays page if needed.'); setPicked([]); reload(); }} />}
    </>
  );
}

function RejectForm({ entry, onClose, onDone }: { entry: EntryRow; onClose: () => void; onDone: (undone: boolean) => void }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.rejectEntry(entry.entryId, reason, user);
      onDone(r.undone);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send back.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Send back ${entry.qrCode}`} onClose={onClose}>
      <p className="mb-4 text-sm">
        {entry.operatorName} entered <b>{entry.bottlesHandled}</b> bottles in, <b>{entry.bottlesProduced}</b> new, <b>{entry.bottlesLost}</b> lost.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Reason" hint="The operator sees this on their phone.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. new bottle count is wrong, recount tray" autoFocus />
        </Field>
        <p className={`rounded-lg px-3 py-2 text-sm ${entry.undoable ? 'bg-amberx-100 text-amberx-700' : 'bg-black/[0.04] text-ink-muted'}`}>
          {entry.undoable
            ? 'The new trays from this entry have not been touched, so they will be removed and the old tray made active again.'
            : 'The tray records will stay as they are (sample entry, or the new trays are already in use).'}
        </p>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy}>{busy ? 'Saving…' : 'Send back'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
