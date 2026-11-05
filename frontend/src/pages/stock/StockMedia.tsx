import { useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorText, Field, FormActions, IconButton, Input, Kpi, Modal, PageHeader, Select, Table, Tabs } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { ItemRow, LotRow, TxnRow } from '../../lib/opsApi';
import { fmt, fmtDate } from '../../lib/paths';
import { CATEGORY_LABEL, type ItemCategory, type MediaRecipe, type TxnType } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

type Tab = 'stock' | 'media' | 'history';
const CATEGORIES = Object.keys(CATEGORY_LABEL) as ItemCategory[];
const num = (n: number) => (Number.isInteger(n) ? fmt(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const TXN: Record<TxnType, { label: string; tone: 'green' | 'blue' | 'amber' }> = {
  IN: { label: 'Received', tone: 'green' },
  OUT: { label: 'Used', tone: 'blue' },
  ADJ: { label: 'Count', tone: 'amber' },
};

/** Stock of chemicals and consumables, media lots, and the record of every stock change. Manager and supervisors. */
export default function StockMedia() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('stock');
  const { data, error, reload } = useLoad(
    () => (user ? Promise.all([api.listItems(user), api.listMediaLots(user), api.listTxns(user), api.listRecipes()]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  const [move, setMove] = useState<null | { item: ItemRow; type: TxnType }>(null);
  const [editing, setEditing] = useState<null | Partial<ItemRow>>(null);
  const [newLot, setNewLot] = useState(false);
  const [items, lots, txns, recipes] = data ?? [[], [], [], []];
  const low = items.filter((i) => i.low);
  const usable = lots.filter((l) => l.state === 'USABLE');

  return (
    <>
      <PageHeader
        title="Stock and media"
        subtitle="Quantities only. What the lab spends is entered as monthly totals on the Monthly costs page."
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing({ category: 'CHEMICAL', stockQty: 0, reorderLevel: 0 })}><Plus size={16} /> New item</Button>
            <Button onClick={() => setNewLot(true)}><FlaskConical size={16} /> Make media lot</Button>
          </>
        }
      />
      <ErrorText>{error}</ErrorText>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Items" value={items.length} />
        <Kpi label="Below reorder level" value={low.length} note={low.length ? low.map((i) => i.name).join(', ') : 'all fine'} />
        <Kpi label="Usable media lots" value={usable.length} note={`${fmt(usable.reduce((n, l) => n + l.bottlesLeft, 0))} bottles ready`} />
        <Kpi label="Lots expired unused" value={lots.filter((l) => l.state === 'EXPIRED' && l.bottlesLeft > 0).length} note="last 30 days" />
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'stock', label: 'Stock' }, { id: 'media', label: `Media lots (${lots.length})` }, { id: 'history', label: 'Stock record' }]} />

      {tab === 'stock' && (
        <Card>
          <Table<ItemRow>
            rowKey={(i) => i.itemId}
            rows={items}
            empty={data ? 'No items yet. Add the chemicals and consumables you keep.' : 'Loading…'}
            columns={[
              { key: 'n', header: 'Item', render: (i) => <div><div className="font-semibold">{i.name}</div><div className="text-xs text-ink-muted">{CATEGORY_LABEL[i.category]}</div></div> },
              { key: 's', header: 'In stock', align: 'right', render: (i) => <span className={i.low ? 'font-semibold text-redx-700' : ''}>{num(i.stockQty)} {i.unit}</span> },
              { key: 'r', header: 'Reorder at', align: 'right', render: (i) => `${num(i.reorderLevel)} ${i.unit}` },
              { key: 'u', header: 'Used, 30 days', align: 'right', render: (i) => (i.usedLast30 ? `${num(i.usedLast30)} ${i.unit}` : '—') },
              { key: 'l', header: '', render: (i) => (i.low ? <Badge tone="red">Reorder</Badge> : null) },
              {
                key: 'a', header: '', render: (i) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" className="min-h-[36px] px-2.5" onClick={() => setMove({ item: i, type: 'IN' })}><ArrowDownToLine size={15} /> Receive</Button>
                    <Button variant="ghost" className="min-h-[36px] px-2.5" onClick={() => setMove({ item: i, type: 'OUT' })}><ArrowUpFromLine size={15} /> Use</Button>
                    <Button variant="ghost" className="min-h-[36px] px-2.5" onClick={() => setMove({ item: i, type: 'ADJ' })}><ClipboardList size={15} /> Count</Button>
                    <IconButton label="Edit item" onClick={() => setEditing(i)}><Pencil size={15} /></IconButton>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}

      {tab === 'media' && (
        <Card title="Media lots, last 30 days">
          <Table<LotRow>
            rowKey={(l) => l.mediaLotId}
            rows={lots}
            empty={data ? 'No media made in the last 30 days.' : 'Loading…'}
            columns={[
              { key: 'c', header: 'Lot', render: (l) => <span className="font-mono text-[13px] font-semibold">{l.lotCode}</span> },
              { key: 'p', header: 'Made', render: (l) => <div>{fmtDate(l.preparedOn)}<div className="text-xs text-ink-muted">by {l.preparedByName}</div></div> },
              { key: 'v', header: 'Litres', align: 'right', render: (l) => num(l.volumeLitre) },
              { key: 'b', header: 'Bottles used / filled', align: 'right', render: (l) => `${fmt(l.bottlesUsed)} / ${fmt(l.bottlesFilled)}` },
              { key: 'e', header: 'Use by', render: (l) => fmtDate(l.expiresOn) },
              {
                key: 's', header: 'State', render: (l) => (
                  l.state === 'USABLE' ? <Badge tone="green">Usable · {fmt(l.bottlesLeft)} left</Badge>
                    : l.state === 'USED_UP' ? <Badge>Used up</Badge>
                    : <Badge tone={l.bottlesLeft > 0 ? 'amber' : 'grey'}>Expired{l.bottlesLeft > 0 ? ` · ${fmt(l.bottlesLeft)} unused` : ''}</Badge>
                ),
              },
              { key: 'm', header: 'Media losses', align: 'right', render: (l) => (l.mediaLosses ? <span className="font-semibold text-redx-700">{l.mediaLosses}</span> : '—') },
            ]}
          />
          <p className="mt-3 text-xs text-ink-muted">“Bottles used” counts trays whose sub-culture recorded this lot. “Media losses” are bottles in those trays lost with cause “Media lot”, so a bad lot shows up here.</p>
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Every stock change, last 30 days">
          <Table<TxnRow>
            rowKey={(t) => t.txnId}
            rows={txns}
            empty={data ? 'No stock changes in the last 30 days.' : 'Loading…'}
            columns={[
              { key: 'd', header: 'Date', render: (t) => fmtDate(t.txnDate) },
              { key: 'i', header: 'Item', render: (t) => t.itemName },
              { key: 't', header: 'Type', render: (t) => <Badge tone={TXN[t.txnType].tone}>{TXN[t.txnType].label}</Badge> },
              { key: 'q', header: 'Quantity', align: 'right', render: (t) => `${t.txnType === 'IN' ? '+' : t.txnType === 'OUT' ? '−' : t.qty > 0 ? '+' : '−'}${num(Math.abs(t.qty))} ${t.unit}` },
              { key: 'n', header: 'Note', render: (t) => <span className="text-ink-muted">{t.lotCode ? `Media lot ${t.lotCode}` : t.note || '—'}</span> },
              { key: 'b', header: 'By', render: (t) => t.doneByName },
            ]}
          />
        </Card>
      )}

      {move && <MoveForm item={move.item} type={move.type} onClose={() => setMove(null)} onSaved={reload} />}
      {editing && <ItemForm item={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {newLot && <LotForm items={items} recipes={recipes} onClose={() => setNewLot(false)} onSaved={reload} />}
    </>
  );
}

function MoveForm({ item, type, onClose, onSaved }: { item: ItemRow; type: TxnType; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [qty, setQty] = useState<number | ''>(type === 'ADJ' ? item.stockQty : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = type === 'IN' ? `Receive ${item.name}` : type === 'OUT' ? `Use ${item.name}` : `Stock count: ${item.name}`;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.stockMove(item.itemId, type, qty === '' ? 0 : qty, note, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const after = qty === '' ? item.stockQty : type === 'IN' ? item.stockQty + qty : type === 'OUT' ? item.stockQty - qty : qty;
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm">In stock now: <b>{num(item.stockQty)} {item.unit}</b></p>
        <Field label={type === 'ADJ' ? `Counted on the shelf (${item.unit})` : `Quantity (${item.unit})`} hint={`Stock after this: ${num(Math.round(after * 100) / 100)} ${item.unit}`}>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value === '' ? '' : Number(e.target.value))} autoFocus />
        </Field>
        <Field label="Note" hint={type === 'ADJ' ? 'Required: why the count is different.' : 'Optional'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'IN' ? 'e.g. bill no. or from whom' : type === 'OUT' ? 'e.g. cleaning hoods' : 'e.g. broken, spilled'} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: Partial<ItemRow>; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [v, setV] = useState({ name: item.name ?? '', category: item.category ?? 'CHEMICAL', unit: item.unit ?? '', stockQty: item.stockQty ?? 0, reorderLevel: item.reorderLevel ?? 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isNew = item.itemId === undefined;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.saveItem({ ...v, itemId: item.itemId }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isNew ? 'New item' : `Edit ${item.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Agar" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as ItemCategory })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field label="Unit"><Input value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} placeholder="kg, g, L, pcs" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {isNew ? (
            <Field label="Opening stock"><Input type="number" min={0} step="any" value={v.stockQty} onChange={(e) => setV({ ...v, stockQty: Number(e.target.value) })} /></Field>
          ) : (
            <Field label="In stock" hint="Change with Receive, Use or Count."><Input value={`${num(v.stockQty)} ${v.unit}`} disabled /></Field>
          )}
          <Field label="Reorder at" hint="Warn when stock falls to this."><Input type="number" min={0} step="any" value={v.reorderLevel} onChange={(e) => setV({ ...v, reorderLevel: Number(e.target.value) })} /></Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}

function LotForm({ items, recipes, onClose, onSaved }: { items: ItemRow[]; recipes: MediaRecipe[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const chemicals = items.filter((i) => i.category === 'CHEMICAL' || i.category === 'CONSUMABLE');
  const [recipeId, setRecipeId] = useState(recipes[0]?.recipeId ?? 0);
  const [preparedOn, setPreparedOn] = useState(today());
  const [litres, setLitres] = useState<number | ''>('');
  const [bottles, setBottles] = useState<number | ''>('');
  const [used, setUsed] = useState<{ itemId: number; qty: number | '' }[]>([{ itemId: chemicals[0]?.itemId ?? 0, qty: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recipe = recipes.find((r) => r.recipeId === recipeId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await api.createMediaLot({
        recipeId, preparedOn, volumeLitre: litres === '' ? 0 : litres, bottlesFilled: bottles === '' ? 0 : bottles,
        used: used.filter((u) => u.qty !== '' && u.qty > 0).map((u) => ({ itemId: u.itemId, qty: Number(u.qty) })),
      }, user);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const setRow = (k: number, row: { itemId: number; qty: number | '' }) => setUsed(used.map((u, i) => (i === k ? row : u)));

  return (
    <Modal title="Make a media lot" onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Recipe" hint={recipe ? `Usable for ${recipe.shelfLifeDays} day${recipe.shelfLifeDays === 1 ? '' : 's'} (set in Set-up → Media).` : undefined}>
            <Select value={recipeId} onChange={(e) => setRecipeId(Number(e.target.value))}>
              {recipes.map((r) => <option key={r.recipeId} value={r.recipeId}>{r.code} · {r.phase.toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Made on"><Input type="date" max={today()} value={preparedOn} onChange={(e) => setPreparedOn(e.target.value)} /></Field>
          <Field label="Volume (litres)"><Input type="number" min={0} step="any" value={litres} onChange={(e) => setLitres(e.target.value === '' ? '' : Number(e.target.value))} /></Field>
          <Field label="Bottles filled"><Input type="number" min={0} value={bottles} onChange={(e) => setBottles(e.target.value === '' ? '' : Math.round(Number(e.target.value)))} /></Field>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Taken from stock</div>
          <div className="flex flex-col gap-2">
            {used.map((u, k) => {
              const it = chemicals.find((i) => i.itemId === u.itemId);
              return (
                <div key={k} className="flex items-center gap-2">
                  <Select value={u.itemId} onChange={(e) => setRow(k, { ...u, itemId: Number(e.target.value) })} aria-label="Item" className="flex-1">
                    {chemicals.map((i) => <option key={i.itemId} value={i.itemId}>{i.name} ({num(i.stockQty)} {i.unit} in stock)</option>)}
                  </Select>
                  <Input type="number" min={0} step="any" value={u.qty} onChange={(e) => setRow(k, { ...u, qty: e.target.value === '' ? '' : Number(e.target.value) })} className="w-28" aria-label="Quantity" placeholder={it?.unit} />
                  <IconButton label="Remove line" tone="danger" onClick={() => setUsed(used.filter((_, i) => i !== k))}><Trash2 size={15} /></IconButton>
                </div>
              );
            })}
          </div>
          <Button type="button" variant="ghost" className="mt-1" onClick={() => setUsed([...used, { itemId: chemicals[0]?.itemId ?? 0, qty: '' }])}><Plus size={15} /> Add item</Button>
        </div>
        <ErrorText>{error}</ErrorText>
        <FormActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !recipes.length}>{busy ? 'Saving…' : 'Save lot'}</Button>
        </FormActions>
      </form>
    </Modal>
  );
}
