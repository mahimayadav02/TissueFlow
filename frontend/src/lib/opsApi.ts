// FAKE API, Phase 5: stock, media lots, monthly costs and orders.
// Stock and media: manager and supervisors. Costs and orders: manager only.
import { addDays, copy, daysBetween, need, same, today, wait, type New } from './apiUtil';
import { availability, batchCostSoFar, knownMonths, monthSummary, rateFor, type Availability, type MonthSummary } from './forecast';
import { db, nextId, save } from './store';
import type { CostHeading, Decision, Delivery, Item, MediaLot, Phase, SalesOrder, Settings, StockTxn, TxnType, User } from './types';

const nameOf = (id: number) => db.users.find((u) => u.userId === id)?.fullName ?? '—';
const managerOnly = (user: User) => need(user.role === 'MANAGER', 'Only the manager can do this.');
const staffOnly = (user: User) => need(user.role !== 'OPERATOR', 'Only a supervisor or manager can do this.');
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- shapes returned to pages ----------
export interface ItemRow extends Item {
  low: boolean;
  usedLast30: number;
}

export interface TxnRow extends StockTxn {
  itemName: string;
  unit: string;
  doneByName: string;
  lotCode: string | null;
}

export type LotState = 'USABLE' | 'EXPIRED' | 'USED_UP';

export interface LotRow extends MediaLot {
  recipeCode: string;
  phase: Phase;
  bottlesUsed: number;
  bottlesLeft: number;
  state: LotState;
  preparedByName: string;
  /** Losses recorded as "media" in trays filled from this lot. */
  mediaLosses: number;
}

export interface NewLotInput {
  recipeId: number;
  preparedOn: string;
  volumeLitre: number;
  bottlesFilled: number;
  used: { itemId: number; qty: number }[];
}

export interface OrderRow extends SalesOrder {
  cropName: string;
  plantsSent: number;
  revenueSoFar: number;
  deliveries: (Delivery & { batchCode: string })[];
}

export interface OrderCheck extends Availability {
  decision: Decision;
  plantsPromised: number;
  expectedRevenue: number;
  expectedCost: number | null;
  expectedProfit: number | null;
}

export interface OrderInput {
  customerName: string;
  phone: string;
  cropId: number;
  plantsOrdered: number;
  ratePerPlant: number;
  requiredBy: string;
}

export interface BatchCostRow {
  batchId: number;
  batchCode: string;
  status: string;
  costSoFar: number;
}

function lotRow(l: MediaLot): LotRow {
  const r = db.recipes.find((x) => x.recipeId === l.recipeId);
  const filled = db.trays.filter((t) => t.mediaLotId === l.mediaLotId);
  // Bottles used = bottles the trays had when they were made (later losses don't give bottles back).
  const used = filled.reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
  const left = Math.max(0, l.bottlesFilled - used);
  const trayIds = new Set(filled.map((t) => t.trayId));
  return {
    ...copy(l),
    recipeCode: r?.code ?? '—',
    phase: r?.phase ?? 'MULTIPLICATION',
    bottlesUsed: used,
    bottlesLeft: left,
    state: today() > l.expiresOn ? 'EXPIRED' : left <= 0 ? 'USED_UP' : 'USABLE',
    preparedByName: nameOf(l.preparedBy),
    mediaLosses: db.contaminations.filter((c) => trayIds.has(c.trayId) && c.cause === 'MEDIA').reduce((n, c) => n + c.bottlesLost, 0),
  };
}

function orderRow(o: SalesOrder): OrderRow {
  const ds = db.deliveries.filter((d) => d.orderId === o.orderId);
  const sent = ds.reduce((n, d) => n + d.plantsSent, 0);
  const crop = db.crops.find((c) => c.cropId === o.cropId);
  return {
    ...copy(o),
    cropName: crop ? `${crop.name} ${crop.variety}` : '—',
    plantsSent: sent,
    revenueSoFar: sent * o.ratePerPlant,
    deliveries: ds.map((d) => ({ ...copy(d), batchCode: db.batches.find((b) => b.batchId === d.batchId)?.batchCode ?? '—' })).sort((a, b) => a.sentOn.localeCompare(b.sentOn)),
  };
}

function check(input: OrderInput, excludeOrderId?: number): OrderCheck {
  const a = availability(input.cropId, input.requiredBy, excludeOrderId);
  const decision: Decision = a.available >= input.plantsOrdered ? 'YES' : a.available > 0 ? 'PARTLY' : 'NO';
  const plantsPromised = Math.min(input.plantsOrdered, a.available);
  const expectedRevenue = plantsPromised * input.ratePerPlant;
  const expectedCost = a.costPerPlant === null ? null : plantsPromised * a.costPerPlant;
  return { ...a, decision, plantsPromised, expectedRevenue, expectedCost, expectedProfit: expectedCost === null ? null : expectedRevenue - expectedCost };
}

function validOrder(o: OrderInput) {
  need(o.customerName.trim(), 'Customer name is required.');
  need(!o.phone || /^\d{10}$/.test(o.phone), 'Phone must be 10 digits (or leave it empty).');
  need(db.crops.some((c) => c.cropId === o.cropId), 'Choose a crop.');
  need(Number.isInteger(o.plantsOrdered) && o.plantsOrdered > 0, 'Plants ordered must be a whole number above 0.');
  need(o.ratePerPlant > 0, 'Rate per plant must be above 0.');
  need(o.requiredBy && o.requiredBy > today(), 'The date needed must be after today.');
}

export const opsApi = {
  // ---------- stock ----------
  async listItems(user: User): Promise<ItemRow[]> {
    await wait();
    staffOnly(user);
    const from = addDays(today(), -30);
    return db.items.map((i) => ({
      ...copy(i),
      low: i.stockQty <= i.reorderLevel,
      usedLast30: round2(db.stockTxns.filter((t) => t.itemId === i.itemId && t.txnType === 'OUT' && t.txnDate >= from).reduce((n, t) => n + t.qty, 0)),
    })).sort((a, b) => Number(b.low) - Number(a.low) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },

  async saveItem(i: New<Item, 'itemId'>, user: User): Promise<Item> {
    await wait();
    staffOnly(user);
    need(i.name.trim(), 'Item name is required.');
    need(i.unit.trim(), 'Unit is required, e.g. kg, L, pcs.');
    need(i.reorderLevel >= 0, 'Reorder level cannot be negative.');
    need(!db.items.some((x) => same(x.name, i.name) && x.itemId !== i.itemId), 'An item with this name already exists.');
    const old = i.itemId ? db.items.find((x) => x.itemId === i.itemId) : undefined;
    if (old) {
      // Stock quantity changes only through receive / use / count, so it keeps its history.
      Object.assign(old, { name: i.name.trim(), category: i.category, unit: i.unit.trim(), reorderLevel: i.reorderLevel });
      save();
      return copy(old);
    }
    need(i.stockQty >= 0, 'Opening stock cannot be negative.');
    const row: Item = { ...i, name: i.name.trim(), unit: i.unit.trim(), itemId: nextId(db.items, 'itemId') };
    db.items.push(row);
    if (row.stockQty > 0) db.stockTxns.push({ txnId: nextId(db.stockTxns, 'txnId'), itemId: row.itemId, txnType: 'IN', qty: row.stockQty, mediaLotId: null, txnDate: today(), doneBy: user.userId, note: 'Opening stock' });
    save();
    return copy(row);
  },

  /** IN: received. OUT: used. ADJ: qty is the counted stock; the difference is recorded. */
  async stockMove(itemId: number, type: TxnType, qty: number, note: string, user: User): Promise<void> {
    await wait();
    staffOnly(user);
    const i = db.items.find((x) => x.itemId === itemId);
    need(i, 'Item not found.');
    need(Number.isFinite(qty) && qty >= 0, 'Enter a quantity of 0 or more.');
    let change = 0;
    if (type === 'IN') { need(qty > 0, 'Quantity received must be above 0.'); change = qty; }
    if (type === 'OUT') { need(qty > 0, 'Quantity used must be above 0.'); need(qty <= i!.stockQty, `Only ${i!.stockQty} ${i!.unit} in stock.`); change = -qty; }
    if (type === 'ADJ') { change = round2(qty - i!.stockQty); need(change !== 0, 'The counted stock is the same as the system stock.'); need(note.trim(), 'Write why the count is different, e.g. broken, spilled.'); }
    i!.stockQty = round2(i!.stockQty + change);
    db.stockTxns.push({ txnId: nextId(db.stockTxns, 'txnId'), itemId, txnType: type, qty: type === 'ADJ' ? change : qty, mediaLotId: null, txnDate: today(), doneBy: user.userId, note: note.trim() });
    save();
  },

  async listTxns(user: User, days = 30): Promise<TxnRow[]> {
    await wait();
    staffOnly(user);
    const from = addDays(today(), -days);
    return db.stockTxns.filter((t) => t.txnDate >= from).map((t) => {
      const i = db.items.find((x) => x.itemId === t.itemId);
      return {
        ...copy(t), itemName: i?.name ?? '—', unit: i?.unit ?? '', doneByName: nameOf(t.doneBy),
        lotCode: t.mediaLotId ? db.mediaLots.find((l) => l.mediaLotId === t.mediaLotId)?.lotCode ?? null : null,
      };
    }).sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.txnId - a.txnId);
  },

  // ---------- media lots ----------
  async listMediaLots(user: User, days = 30): Promise<LotRow[]> {
    await wait();
    const from = addDays(today(), -days);
    void user;
    return db.mediaLots.filter((l) => l.preparedOn >= from).map(lotRow).sort((a, b) => b.preparedOn.localeCompare(a.preparedOn) || b.mediaLotId - a.mediaLotId);
  },

  /** Lots that can fill new bottles for a stage phase today (used in the sub-culture form). */
  async usableLots(phase: Phase): Promise<LotRow[]> {
    await wait(50);
    return db.mediaLots.map(lotRow).filter((l) => l.state === 'USABLE' && l.phase === phase);
  },

  async createMediaLot(input: NewLotInput, user: User): Promise<MediaLot> {
    await wait();
    staffOnly(user);
    const r = db.recipes.find((x) => x.recipeId === input.recipeId);
    need(r, 'Choose a recipe.');
    need(input.preparedOn && input.preparedOn <= today() && input.preparedOn >= addDays(today(), -7), 'Prepared date must be within the last 7 days.');
    need(input.volumeLitre > 0, 'Volume must be above 0 litres.');
    need(Number.isInteger(input.bottlesFilled) && input.bottlesFilled > 0, 'Bottles filled must be a whole number above 0.');
    const used = input.used.filter((u) => u.qty > 0);
    for (const u of used) {
      const i = db.items.find((x) => x.itemId === u.itemId);
      need(i, 'Item not found.');
      need(u.qty <= i!.stockQty, `Only ${i!.stockQty} ${i!.unit} of ${i!.name} in stock.`);
    }
    need(new Set(used.map((u) => u.itemId)).size === used.length, 'Each item can be listed only once.');
    const dd = input.preparedOn.slice(8, 10) + input.preparedOn.slice(5, 7);
    const base = `${r!.code}-${dd}`;
    let code = base;
    for (let k = 0; db.mediaLots.some((l) => l.lotCode === code); k++) code = base + String.fromCharCode(66 + k);
    const lot: MediaLot = {
      mediaLotId: nextId(db.mediaLots, 'mediaLotId'), lotCode: code, recipeId: r!.recipeId, preparedOn: input.preparedOn,
      volumeLitre: input.volumeLitre, bottlesFilled: input.bottlesFilled, expiresOn: addDays(input.preparedOn, r!.shelfLifeDays), preparedBy: user.userId,
    };
    db.mediaLots.push(lot);
    for (const u of used) {
      const i = db.items.find((x) => x.itemId === u.itemId)!;
      i.stockQty = round2(i.stockQty - u.qty);
      db.stockTxns.push({ txnId: nextId(db.stockTxns, 'txnId'), itemId: u.itemId, txnType: 'OUT', qty: u.qty, mediaLotId: lot.mediaLotId, txnDate: input.preparedOn, doneBy: user.userId, note: `For media lot ${code}` });
    }
    save();
    return copy(lot);
  },

  // ---------- monthly costs ----------
  async getMonth(month: string, user: User): Promise<MonthSummary & { rateUsed: number; rateIsOwn: boolean }> {
    await wait();
    managerOnly(user);
    const s = monthSummary(month);
    return { ...s, rateUsed: rateFor(month), rateIsOwn: s.costPerBottle !== null };
  },

  async saveMonthCosts(month: string, amounts: Partial<Record<CostHeading, number>>, user: User): Promise<void> {
    await wait();
    managerOnly(user);
    need(/^\d{4}-\d{2}$/.test(month), 'Choose a month.');
    need(month <= today().slice(0, 7), 'Costs cannot be entered for a future month.');
    for (const [h, v] of Object.entries(amounts) as [CostHeading, number][]) {
      need(Number.isFinite(v) && v >= 0, 'Amounts cannot be negative.');
      const row = db.costs.find((c) => c.month === month && c.heading === h);
      if (row) {
        row.amount = v;
        row.enteredBy = user.userId;
      } else if (v > 0) db.costs.push({ costId: nextId(db.costs, 'costId'), month, heading: h, amount: v, enteredBy: user.userId });
    }
    db.costs = db.costs.filter((c) => c.amount > 0);
    save();
  },

  async monthHistory(user: User, count = 6): Promise<MonthSummary[]> {
    await wait();
    managerOnly(user);
    return knownMonths().slice(0, count).map(monthSummary);
  },

  async batchCosts(user: User): Promise<BatchCostRow[]> {
    await wait();
    managerOnly(user);
    const cache = new Map<string, number | null>();
    return db.batches.map((b) => ({ batchId: b.batchId, batchCode: b.batchCode, status: b.status, costSoFar: batchCostSoFar(b.batchId, cache) }))
      .sort((a, b) => b.costSoFar - a.costSoFar);
  },

  // ---------- orders ----------
  async listOrders(user: User): Promise<OrderRow[]> {
    await wait();
    managerOnly(user);
    const rank = { OPEN: 0, DELIVERED: 1, CANCELLED: 2 };
    return db.orders.map(orderRow).sort((a, b) => rank[a.status] - rank[b.status] || a.requiredBy.localeCompare(b.requiredBy));
  },

  /** "Can we deliver by this date?" Uses the forecast of running batches of that crop, minus plants already promised. */
  async checkOrder(input: OrderInput, user: User, excludeOrderId?: number): Promise<OrderCheck> {
    await wait(150);
    managerOnly(user);
    validOrder(input);
    return check(input, excludeOrderId);
  },

  async createOrder(input: OrderInput, user: User): Promise<SalesOrder> {
    await wait();
    managerOnly(user);
    validOrder(input);
    const c = check(input);
    const o: SalesOrder = {
      ...input, customerName: input.customerName.trim(), orderId: nextId(db.orders, 'orderId'),
      orderCode: `O-${100 + nextId(db.orders, 'orderId')}`, decision: c.decision, plantsPromised: c.plantsPromised,
      status: 'OPEN', createdAt: new Date().toISOString(), createdBy: user.userId,
    };
    db.orders.push(o);
    save();
    return copy(o);
  },

  /** Checks an open order again with today's forecast and saves the new decision. */
  async recheckOrder(orderId: number, user: User): Promise<OrderCheck> {
    await wait();
    managerOnly(user);
    const o = db.orders.find((x) => x.orderId === orderId);
    need(o && o.status === 'OPEN', 'Only open orders can be checked again.');
    need(o!.requiredBy > today(), 'The date needed has passed.');
    const sent = db.deliveries.filter((d) => d.orderId === orderId).reduce((n, d) => n + d.plantsSent, 0);
    const c = check({ ...o!, plantsOrdered: o!.plantsOrdered - sent }, orderId);
    o!.decision = sent > 0 && c.decision === 'NO' ? 'PARTLY' : c.decision;
    o!.plantsPromised = sent + c.plantsPromised;
    save();
    return c;
  },

  async cancelOrder(orderId: number, user: User): Promise<void> {
    await wait();
    managerOnly(user);
    const o = db.orders.find((x) => x.orderId === orderId);
    need(o && o.status === 'OPEN', 'Only open orders can be cancelled.');
    o!.status = 'CANCELLED';
    save();
  },

  /** Batches of a crop with plants in hardening, which can be sent. */
  async hardenedStock(cropId: number): Promise<{ batchId: number; batchCode: string; plants: number; stages: string }[]> {
    await wait(50);
    const hardening = new Set(db.stages.filter((s) => s.phase === 'HARDENING').map((s) => s.stageId));
    return db.batches.filter((b) => b.cropId === cropId && b.status === 'RUNNING').map((b) => {
      const ts = db.trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE' && hardening.has(t.stageId));
      const codes = [...new Set(ts.map((t) => db.stages.find((s) => s.stageId === t.stageId)?.code))].join(', ');
      return { batchId: b.batchId, batchCode: b.batchCode, plants: ts.reduce((n, t) => n + t.bottleCount, 0), stages: codes };
    }).filter((x) => x.plants > 0);
  },

  /** Plants sent: taken from the batch's hardening trays (secondary hardening first). */
  async recordDelivery(orderId: number, batchId: number, plants: number, sentOn: string, user: User): Promise<void> {
    await wait();
    managerOnly(user);
    const o = db.orders.find((x) => x.orderId === orderId);
    need(o && o.status === 'OPEN', 'Plants can be sent only for an open order.');
    need(o!.decision !== 'NO', 'This order was declined. Check it again first if plants are now available.');
    need(Number.isInteger(plants) && plants > 0, 'Plants sent must be a whole number above 0.');
    need(sentOn && sentOn <= today() && daysBetween(sentOn) <= 7, 'Date sent must be within the last 7 days.');
    const sent = db.deliveries.filter((d) => d.orderId === orderId).reduce((n, d) => n + d.plantsSent, 0);
    need(sent + plants <= o!.plantsOrdered, `Only ${o!.plantsOrdered - sent} plants are left on this order.`);
    const b = db.batches.find((x) => x.batchId === batchId);
    need(b && b.cropId === o!.cropId, 'Choose a batch of the same crop as the order.');
    const hardening = db.stages.filter((s) => s.phase === 'HARDENING').sort((x, y) => y.seqNo - x.seqNo);
    const trays = hardening.flatMap((s) => db.trays.filter((t) => t.batchId === batchId && t.status === 'ACTIVE' && t.stageId === s.stageId));
    const have = trays.reduce((n, t) => n + t.bottleCount, 0);
    need(plants <= have, `${b!.batchCode} has only ${have} plants in hardening.`);
    let left = plants;
    for (const t of trays) {
      if (!left) break;
      const take = Math.min(left, t.bottleCount);
      t.bottleCount -= take;
      left -= take;
      if (t.bottleCount === 0) t.status = 'SENT';
    }
    db.deliveries.push({ deliveryId: nextId(db.deliveries, 'deliveryId'), orderId, batchId, plantsSent: plants, sentOn, enteredBy: user.userId });
    if (sent + plants >= Math.max(o!.plantsPromised, 1) && sent + plants >= o!.plantsOrdered) o!.status = 'DELIVERED';
    if (sent + plants > o!.plantsPromised) o!.plantsPromised = sent + plants;
    save();
  },

  // ---------- forecast settings ----------
  async getSettings(): Promise<Settings> {
    await wait(50);
    return copy(db.settings);
  },

  async saveSettings(s: Settings, user: User): Promise<Settings> {
    await wait();
    managerOnly(user);
    need(s.rootingSurvival > 0 && s.rootingSurvival <= 1 && s.hardeningSurvival > 0 && s.hardeningSurvival <= 1, 'Survival must be between 1% and 100%.');
    const st = db.stages.find((x) => x.code === s.lastMultiplicationStage);
    need(st && st.phase === 'MULTIPLICATION', 'Choose a multiplication stage.');
    need(s.defaultRate === undefined || s.defaultRate > 0, 'Sale rate must be above 0.');
    db.settings = { ...s };
    save();
    return copy(db.settings);
  },
};
