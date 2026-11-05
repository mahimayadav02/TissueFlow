import { useState } from 'react';
import { Pencil, Plus, UserMinus, UserPlus } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Field, FormActions, IconButton, Input, Modal, PageHeader, Select, Table, cn } from '../../../components/ui';
import { api, type New } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { ROLE_LABEL, SCOPE_OF, type Area, type Role, type User } from '../../../lib/types';
import { useLoad } from '../../../lib/useLoad';
import { useSave } from '../../../lib/useSave';

type Filter = 'ALL' | Role;
const ROLES: Role[] = ['MANAGER', 'SUPERVISOR', 'OPERATOR'];
const roleTone = (r: Role) => (r === 'MANAGER' ? 'purple' : r === 'SUPERVISOR' ? 'green' : 'blue');

/** Everyone who works in the lab, with their role and zones. Manager only. */
export default function Users() {
  const { user: me } = useAuth();
  const { data, error, reload } = useLoad(() => Promise.all([api.listUsers(), api.listAreas()]));
  const [filter, setFilter] = useState<Filter>('ALL');
  const [showLeft, setShowLeft] = useState(false);
  const [edit, setEdit] = useState<New<User, 'userId'> | null>(null);
  const [actionError, setActionError] = useState('');

  const [users, areas] = data ?? [[], []];
  const zoneName = (id: number | null) => areas.find((a) => a.areaId === id)?.name ?? '—';
  const rows = users
    .filter((u) => (filter === 'ALL' || u.role === filter) && (showLeft || u.status === 'ACTIVE'))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.fullName.localeCompare(b.fullName));
  const count = (r: Role) => users.filter((u) => u.role === r && u.status === 'ACTIVE').length;

  const toggleStatus = async (u: User) => {
    const leaving = u.status === 'ACTIVE';
    if (leaving && !window.confirm(`Mark ${u.fullName} as left? They will not be able to log in. Their past records stay.`)) return;
    setActionError('');
    try { await api.saveUser({ ...u, status: leaving ? 'LEFT' : 'ACTIVE' }); reload(); } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not update.'); }
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Everyone who works in the lab. The role decides what each person can see: manager all zones, supervisor own zones, operator own work."
        actions={<Button onClick={() => setEdit({ fullName: '', phone: '', role: 'OPERATOR', homeAreaId: areas[0]?.areaId ?? null, zoneIds: [], status: 'ACTIVE' })}><Plus size={16} /> Add user</Button>}
      />
      <ErrorText>{error || actionError}</ErrorText>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(['ALL', ...ROLES] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('focus-ring rounded-full border px-3 py-1.5 text-sm', filter === f ? 'border-forest-700 bg-forest-700 text-white' : 'border-[#C6BFB0] bg-white')}
            >
              {f === 'ALL' ? `All (${users.filter((u) => u.status === 'ACTIVE').length})` : `${ROLE_LABEL[f]}s (${count(f)})`}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show people who left
          </label>
        </div>
        <Table
          rowKey={(u) => u.userId}
          rows={rows}
          empty={data ? 'No users match.' : 'Loading…'}
          columns={[
            { key: 'n', header: 'Name', render: (u) => <span className={cn('font-semibold', u.status === 'LEFT' && 'text-ink-muted line-through')}>{u.fullName}</span> },
            { key: 'r', header: 'Role', render: (u) => <Badge tone={roleTone(u.role)}>{ROLE_LABEL[u.role]}</Badge> },
            { key: 'p', header: 'Phone (login)', render: (u) => <span className="tabular-nums">{u.phone}</span> },
            {
              key: 'z', header: 'Zone(s)', render: (u) =>
                u.role === 'MANAGER' ? <span className="text-ink-muted">All zones</span>
                  : u.role === 'SUPERVISOR' ? u.zoneIds.map(zoneName).join(', ')
                    : zoneName(u.homeAreaId),
            },
            { key: 's', header: 'Can see', render: (u) => <span className="text-xs text-ink-muted">{SCOPE_OF[u.role]}</span> },
            {
              key: 'x', header: '', align: 'right', render: (u) => (
                <div className="flex justify-end gap-1">
                  <IconButton label={`Edit ${u.fullName}`} onClick={() => setEdit(u)}><Pencil size={16} /></IconButton>
                  {u.userId !== me?.userId && (
                    u.status === 'ACTIVE'
                      ? <IconButton label={`Mark ${u.fullName} as left`} tone="danger" onClick={() => toggleStatus(u)}><UserMinus size={16} /></IconButton>
                      : <IconButton label={`Make ${u.fullName} active again`} onClick={() => toggleStatus(u)}><UserPlus size={16} /></IconButton>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {edit && <UserForm value={edit} areas={areas} isSelf={edit.userId === me?.userId} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}

function UserForm({ value, areas, isSelf, onClose, onSaved }: { value: New<User, 'userId'>; areas: Area[]; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const isNew = value.userId === undefined;
  const [v, setV] = useState(value);
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSave((u: New<User, 'userId'>) => api.saveUser(u, password || undefined), onSaved, onClose);

  const toggleZone = (id: number) =>
    setV({ ...v, zoneIds: v.zoneIds.includes(id) ? v.zoneIds.filter((z) => z !== id) : [...v.zoneIds, id] });

  return (
    <Modal title={isNew ? 'Add user' : `Edit ${value.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => submit(e, v)} className="flex flex-col gap-4">
        <Field label="Full name"><Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} autoFocus /></Field>
        <Field label="Phone number" hint="Used to log in">
          <Input inputMode="numeric" maxLength={10} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          <Select value={v.role} disabled={isSelf} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>

        {v.role === 'OPERATOR' && (
          <Field label="Works in zone">
            <Select value={v.homeAreaId ?? ''} onChange={(e) => setV({ ...v, homeAreaId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Choose a zone</option>
              {areas.map((a) => <option key={a.areaId} value={a.areaId}>{a.name}</option>)}
            </Select>
          </Field>
        )}

        {v.role === 'SUPERVISOR' && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold">Looks after these zones</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {areas.map((a) => (
                <label key={a.areaId} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', v.zoneIds.includes(a.areaId) ? 'border-forest-700 bg-forest-50' : 'border-line')}>
                  <input type="checkbox" checked={v.zoneIds.includes(a.areaId)} onChange={() => toggleZone(a.areaId)} />
                  {a.name}
                </label>
              ))}
            </div>
            <span className="text-xs text-ink-muted">The supervisor sees and enters data only for these zones.</span>
          </fieldset>
        )}

        {v.role === 'MANAGER' && <p className="rounded-lg bg-forest-50 px-3 py-2 text-sm text-[#2F4F3F]">A manager sees and manages all zones.</p>}

        <Field label={isNew ? 'Password' : 'New password'} hint={isNew ? 'At least 4 characters. Share it with the person.' : 'Leave empty to keep the current password.'}>
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>

        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add user' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
