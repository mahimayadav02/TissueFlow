// Stock, media lots, monthly costs and customer orders. Port of frontend/src/lib/opsApi.ts with the same checks
// and messages. Stock and media: manager and supervisors. Costs and orders: manager only.
import type { CostHeading, Decision, Phase, Prisma, TxnType } from '@prisma/client';
import { addDays, daysBetween, dbDate, labToday } from '../lib/dates.js';
import { ApiError } from '../middleware/errors.js';
import { helpers, type Me } from './daily.js';
import { money, type Availability, type Lab } from './lab.js';

type Db = Prisma.TransactionClient;
const need: (ok: unknown, msg: string, status?: number) => asserts ok = (ok, msg, status = 400) => {
  if (!ok) throw new ApiError(status, msg);
};
const today = () => labToday();
const round2 = (n: number) => Math.round(n * 100) / 100;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const managerOnly = (me: Me) => need(me.role === 'MANAGER', 'Only the manager can do this.', 403);
export const staffOnly = (me: Me) => need(me.role !== 'OPERATOR', 'Only a supervisor or manager can do this.', 403);

// ---------- stock ----------
export function listItems(L: Lab) {
  const from = addDays(today(), -30);
  return L.items.map((i) => ({
    ...i,
    low: i.stockQty <= i.reorderLevel,
    usedLast30: round2(L.txns.filter((t) => t.itemId === i.itemId && t.txnType === 'OUT' && t.txnDate >= from).reduce((n, t) => n + t.qty, 0)),
  })).sort((a, b) => Number(b.low) - Number(a.low) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export interface ItemInput {
  itemId?: number;
  name: string;
  category: 'CHEMICAL' | 'CONSUMABLE' | 'HARDENING' | 'OTHER';
  unit: string;
  stockQty: number;
  reorderLevel: number;
}

export async function saveItem(tx: Db, L: Lab, me: Me, i: ItemInput) {
  need(i.name.trim(), 'Item name is required.');
  need(i.unit.trim(), 'Unit is required, e.g. kg, L, pcs.');
  need(i.reorderLevel >= 0, 'Reorder level cannot be negative.');
  need(!L.items.some((x) => same(x.name, i.name) && x.itemId !== i.itemId), 'An item with this name already exists.', 409);
  const old = i.itemId ? L.items.find((x) => x.itemId === i.itemId) : undefined;
  if (i.itemId) need(old, 'Item not found.', 404);
  if (old) {
    // Stock quantity changes only through receive / use / count, so it keeps its history.
    return tx.item.update({ where: { itemId: old.itemId }, data: { name: i.name.trim(), category: i.category, unit: i.unit.trim(), reorderLevel: i.reorderLevel } });
  }
  need(i.stockQty >= 0, 'Opening stock cannot be negative.');
  const row = await tx.item.create({ data: { name: i.name.trim(), category: i.category, unit: i.unit.trim(), stockQty: i.stockQty, reorderLevel: i.reorderLevel } });
  if (row.stockQty > 0) {
    await tx.stockTxn.create({ data: { itemId: row.itemId, txnType: 'IN', qty: row.stockQty, mediaLotId: null, txnDate: dbDate(today()), doneBy: me.userId, note: 'Opening stock' } });
  }
  return row;
}

/** IN: received. OUT: used. ADJ: qty is the counted stock; the difference is recorded. */
export async function stockMove(tx: Db, L: Lab, me: Me, itemId: number, type: TxnType, qty: number, note: string) {
  const i = L.items.find((x) => x.itemId === itemId);
  need(i, 'Item not found.', 404);
  need(Number.isFinite(qty) && qty >= 0, 'Enter a quantity of 0 or more.');
  let change = 0;
  if (type === 'IN') { need(qty > 0, 'Quantity received must be above 0.'); change = qty; }
  if (type === 'OUT') { need(qty > 0, 'Quantity used must be above 0.'); need(qty <= i.stockQty, `Only ${i.stockQty} ${i.unit} in stock.`); change = -qty; }
  if (type === 'ADJ') { change = round2(qty - i.stockQty); need(change !== 0, 'The counted stock is the same as the system stock.'); need(note.trim(), 'Write why the count is different, e.g. broken, spilled.'); }
  await tx.item.update({ where: { itemId }, data: { stockQty: round2(i.stockQty + change) } });
  await tx.stockTxn.create({ data: { itemId, txnType: type, qty: type === 'ADJ' ? change : qty, mediaLotId: null, txnDate: dbDate(today()), doneBy: me.userId, note: note.trim() } });
  return { item: i.name, change };
}

export function listTxns(L: Lab, days = 30) {
  const h = helpers(L);
  const from = addDays(today(), -days);
  return L.txns.filter((t) => t.txnDate >= from).map((t) => {
    const i = L.items.find((x) => x.itemId === t.itemId);
    return { ...t, itemName: i?.name ?? '—', unit: i?.unit ?? '', doneByName: h.nameOf(t.doneBy), lotCode: t.mediaLotId ? L.lots.find((l) => l.mediaLotId === t.mediaLotId)?.lotCode ?? null : null };
  }).sort((a, b) => b.txnDate.localeCompare(a.txnDate) || b.txnId - a.txnId);
}

// ---------- media lots ----------
export function lotRow(L: Lab, l: Lab['lots'][number]) {
  const h = helpers(L);
  const r = L.recipes.find((x) => x.recipeId === l.recipeId);
  const filled = L.trays.filter((t) => t.mediaLotId === l.mediaLotId);
  // Bottles used = bottles the trays had when they were made (later losses don't give bottles back).
  const used = filled.reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
  const left = Math.max(0, l.bottlesFilled - used);
  const trayIds = new Set(filled.map((t) => t.trayId));
  return {
    mediaLotId: l.mediaLotId, lotCode: l.lotCode, recipeId: l.recipeId, preparedOn: l.preparedOn, volumeLitre: l.volumeLitre,
    bottlesFilled: l.bottlesFilled, expiresOn: l.expiresOn, preparedBy: l.preparedBy,
    recipeCode: r?.code ?? '—',
    phase: (r?.phase ?? 'MULTIPLICATION') as Phase,
    bottlesUsed: used,
    bottlesLeft: left,
    state: (today() > l.expiresOn ? 'EXPIRED' : left <= 0 ? 'USED_UP' : 'USABLE') as 'USABLE' | 'EXPIRED' | 'USED_UP',
    preparedByName: h.nameOf(l.preparedBy),
    mediaLosses: L.conts.filter((x) => trayIds.has(x.trayId) && x.cause === 'MEDIA').reduce((n, x) => n + x.bottlesLost, 0),
  };
}

export const listMediaLots = (L: Lab, days = 30) => {
  const from = addDays(today(), -days);
  return L.lots.filter((l) => l.preparedOn >= from).map((l) => lotRow(L, l)).sort((a, b) => b.preparedOn.localeCompare(a.preparedOn) || b.mediaLotId - a.mediaLotId);
};

/** Lots that can fill new bottles for a stage phase today (used in the sub-culture form). */
export const usableLots = (L: Lab, phase: Phase) => L.lots.map((l) => lotRow(L, l)).filter((l) => l.state === 'USABLE' && l.phase === phase);

export interface NewLotInput {
  recipeId: number;
  lotCode?: string;
  preparedOn: string;
  volumeLitre: number;
  bottlesFilled: number;
  used: { itemId: number; qty: number }[];
}

export async function createMediaLot(tx: Db, L: Lab, me: Me, input: NewLotInput) {
  const h = helpers(L);
  const r = L.recipes.find((x) => x.recipeId === input.recipeId);
  need(r, 'Choose a recipe.');
  need(input.preparedOn && input.preparedOn <= today() && input.preparedOn >= addDays(today(), -7), 'Prepared date must be within the last 7 days.');
  need(input.volumeLitre > 0, 'Volume must be above 0 litres.');
  need(Number.isInteger(input.bottlesFilled) && input.bottlesFilled > 0, 'Bottles filled must be a whole number above 0.');
  const used = input.used.filter((u) => u.qty > 0);
  for (const u of used) {
    const i = L.items.find((x) => x.itemId === u.itemId);
    need(i, 'Item not found.');
    need(u.qty <= i.stockQty, `Only ${i.stockQty} ${i.unit} of ${i.name} in stock.`);
  }
  need(new Set(used.map((u) => u.itemId)).size === used.length, 'Each item can be listed only once.');
  const code = (input.lotCode ?? '').trim() || h.nextMediaBatchCode(input.preparedOn);
  need(code.length <= 20, 'The batch code is too long.');
  need(!L.lots.some((l) => l.lotCode.toLowerCase() === code.toLowerCase()), `Batch code ${code} is already used.`, 409);
  const lot = await tx.mediaLot.create({
    data: {
      lotCode: code, recipeId: r.recipeId, preparedOn: dbDate(input.preparedOn), volumeLitre: input.volumeLitre, bottlesFilled: input.bottlesFilled,
      expiresOn: dbDate(addDays(input.preparedOn, r.shelfLifeDays)), preparedBy: me.userId,
    },
  });
  for (const u of used) {
    const i = L.items.find((x) => x.itemId === u.itemId)!;
    await tx.item.update({ where: { itemId: i.itemId }, data: { stockQty: round2(i.stockQty - u.qty) } });
    await tx.stockTxn.create({ data: { itemId: u.itemId, txnType: 'OUT', qty: u.qty, mediaLotId: lot.mediaLotId, txnDate: dbDate(input.preparedOn), doneBy: me.userId, note: `For media lot ${code}` } });
  }
  return lot;
}

// ---------- monthly costs ----------
export function getMonth(L: Lab, month: string) {
  const m = money(L);
  const s = m.monthSummary(month);
  return { ...s, rateUsed: m.rateFor(month), rateIsOwn: s.costPerBottle !== null };
}

export async function saveMonthCosts(tx: Db, L: Lab, me: Me, month: string, amounts: Partial<Record<CostHeading, number>>) {
  need(/^\d{4}-\d{2}$/.test(month), 'Choose a month.');
  need(month <= today().slice(0, 7), 'Costs cannot be entered for a future month.');
  for (const v of Object.values(amounts)) need(Number.isFinite(v) && (v as number) >= 0, 'Amounts cannot be negative.');
  for (const [heading, v] of Object.entries(amounts) as [CostHeading, number][]) {
    if (v > 0) {
      await tx.costEntry.upsert({
        where: { month_heading: { month, heading } },
        create: { month, heading, amount: v, enteredBy: me.userId },
        update: { amount: v, enteredBy: me.userId },
      });
    } else {
      await tx.costEntry.deleteMany({ where: { month, heading } });
    }
  }
}

export const monthHistory = (L: Lab, count = 6) => {
  const m = money(L);
  return m.knownMonths().slice(0, count).map(m.monthSummary);
};

export const batchCosts = (L: Lab) => {
  const m = money(L);
  return L.batches.map((b) => ({ batchId: b.batchId, batchCode: b.batchCode, status: b.status, costSoFar: m.batchCostSoFar(b.batchId) })).sort((a, b) => b.costSoFar - a.costSoFar);
};

// ---------- orders ----------
export interface OrderInput {
  customerName: string;
  phone: string;
  cropId: number;
  plantsOrdered: number;
  ratePerPlant: number;
  requiredBy: string;
}

function orderRow(L: Lab, o: Lab['orders'][number]) {
  const ds = L.deliveries.filter((d) => d.orderId === o.orderId);
  const sent = ds.reduce((n, d) => n + d.plantsSent, 0);
  const crop = L.crops.find((x) => x.cropId === o.cropId);
  const { createdDate: _c, ...order } = o;
  return {
    ...order,
    cropName: crop ? `${crop.name} ${crop.variety}` : '—',
    plantsSent: sent,
    revenueSoFar: sent * o.ratePerPlant,
    deliveries: ds.map((d) => ({ ...d, batchCode: L.batches.find((b) => b.batchId === d.batchId)?.batchCode ?? '—' })).sort((a, b) => a.sentOn.localeCompare(b.sentOn)),
  };
}

export function listOrders(L: Lab) {
  const rank = { OPEN: 0, DELIVERED: 1, CANCELLED: 2 };
  return L.orders.map((o) => orderRow(L, o)).sort((a, b) => rank[a.status] - rank[b.status] || a.requiredBy.localeCompare(b.requiredBy));
}

export type OrderCheck = Availability & { decision: Decision; plantsPromised: number; expectedRevenue: number; expectedCost: number | null; expectedProfit: number | null };

function check(L: Lab, input: OrderInput, excludeOrderId?: number): OrderCheck {
  const a = money(L).availability(input.cropId, input.requiredBy, excludeOrderId);
  const decision: Decision = a.available >= input.plantsOrdered ? 'YES' : a.available > 0 ? 'PARTLY' : 'NO';
  const plantsPromised = Math.min(input.plantsOrdered, a.available);
  const expectedRevenue = plantsPromised * input.ratePerPlant;
  const expectedCost = a.costPerPlant === null ? null : plantsPromised * a.costPerPlant;
  return { ...a, decision, plantsPromised, expectedRevenue, expectedCost, expectedProfit: expectedCost === null ? null : expectedRevenue - expectedCost };
}

function validOrder(L: Lab, o: OrderInput) {
  need(o.customerName.trim(), 'Customer name is required.');
  need(!o.phone || /^\d{10}$/.test(o.phone), 'Phone must be 10 digits (or leave it empty).');
  need(L.crops.some((x) => x.cropId === o.cropId), 'Choose a crop.');
  need(Number.isInteger(o.plantsOrdered) && o.plantsOrdered > 0, 'Plants ordered must be a whole number above 0.');
  need(o.ratePerPlant > 0, 'Rate per plant must be above 0.');
  need(o.requiredBy && o.requiredBy > today(), 'The date needed must be after today.');
}

export function checkOrder(L: Lab, input: OrderInput, excludeOrderId?: number) {
  validOrder(L, input);
  return check(L, input, excludeOrderId);
}

export async function createOrder(tx: Db, L: Lab, me: Me, input: OrderInput) {
  validOrder(L, input);
  const c = check(L, input);
  const temp = `NEW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const o = await tx.salesOrder.create({
    data: {
      customerName: input.customerName.trim(), phone: input.phone, cropId: input.cropId, plantsOrdered: input.plantsOrdered, ratePerPlant: input.ratePerPlant,
      requiredBy: dbDate(input.requiredBy), decision: c.decision, plantsPromised: c.plantsPromised, createdBy: me.userId, orderCode: temp,
    },
  });
  // Order codes follow the website's pattern: O-101 for order 1, O-102 for order 2 …
  return tx.salesOrder.update({ where: { orderId: o.orderId }, data: { orderCode: `O-${100 + o.orderId}` } });
}

/** Checks an open order again with today's forecast and saves the new decision. */
export async function recheckOrder(tx: Db, L: Lab, orderId: number) {
  const o = L.orders.find((x) => x.orderId === orderId);
  need(o && o.status === 'OPEN', 'Only open orders can be checked again.');
  need(o.requiredBy > today(), 'The date needed has passed.');
  const sent = L.deliveries.filter((d) => d.orderId === orderId).reduce((n, d) => n + d.plantsSent, 0);
  const c = check(L, { ...o, plantsOrdered: o.plantsOrdered - sent }, orderId);
  await tx.salesOrder.update({ where: { orderId }, data: { decision: sent > 0 && c.decision === 'NO' ? 'PARTLY' : c.decision, plantsPromised: sent + c.plantsPromised } });
  return c;
}

export async function cancelOrder(tx: Db, L: Lab, orderId: number) {
  const o = L.orders.find((x) => x.orderId === orderId);
  need(o && o.status === 'OPEN', 'Only open orders can be cancelled.');
  await tx.salesOrder.update({ where: { orderId }, data: { status: 'CANCELLED' } });
  return o;
}

/** Batches of a crop with plants in hardening, which can be sent. */
export function hardenedStock(L: Lab, cropId: number) {
  const hardening = new Set(L.stages.filter((s) => s.phase === 'HARDENING').map((s) => s.stageId));
  return L.batches.filter((b) => b.cropId === cropId && b.status === 'RUNNING').map((b) => {
    const ts = L.trays.filter((t) => t.batchId === b.batchId && t.status === 'ACTIVE' && hardening.has(t.stageId));
    const codes = [...new Set(ts.map((t) => L.stages.find((s) => s.stageId === t.stageId)?.code))].join(', ');
    return { batchId: b.batchId, batchCode: b.batchCode, plants: ts.reduce((n, t) => n + t.bottleCount, 0), stages: codes };
  }).filter((x) => x.plants > 0);
}

/** Plants sent: taken from the batch's hardening trays (secondary hardening first). */
export async function recordDelivery(tx: Db, L: Lab, me: Me, orderId: number, batchId: number, plants: number, sentOn: string) {
  const o = L.orders.find((x) => x.orderId === orderId);
  need(o && o.status === 'OPEN', 'Plants can be sent only for an open order.');
  need(o.decision !== 'NO', 'This order was declined. Check it again first if plants are now available.');
  need(Number.isInteger(plants) && plants > 0, 'Plants sent must be a whole number above 0.');
  need(sentOn && sentOn <= today() && daysBetween(sentOn) <= 7, 'Date sent must be within the last 7 days.');
  const sent = L.deliveries.filter((d) => d.orderId === orderId).reduce((n, d) => n + d.plantsSent, 0);
  need(sent + plants <= o.plantsOrdered, `Only ${o.plantsOrdered - sent} plants are left on this order.`);
  const b = L.batches.find((x) => x.batchId === batchId);
  need(b && b.cropId === o.cropId, 'Choose a batch of the same crop as the order.');
  const hardening = L.stages.filter((s) => s.phase === 'HARDENING').sort((x, y) => y.seqNo - x.seqNo);
  const trays = hardening.flatMap((s) => L.trays.filter((t) => t.batchId === batchId && t.status === 'ACTIVE' && t.stageId === s.stageId));
  const have = trays.reduce((n, t) => n + t.bottleCount, 0);
  need(plants <= have, `${b.batchCode} has only ${have} plants in hardening.`);
  let left = plants;
  for (const t of trays) {
    if (!left) break;
    const take = Math.min(left, t.bottleCount);
    left -= take;
    const rest = t.bottleCount - take;
    const r = await tx.tray.updateMany({
      where: { trayId: t.trayId, version: t.version, status: 'ACTIVE' },
      data: { bottleCount: rest, ...(rest === 0 ? { status: 'SENT' as const } : {}), version: { increment: 1 } },
    });
    need(r.count === 1, `Tray ${t.qrCode} was just changed by someone else. Try again.`, 409);
  }
  await tx.delivery.create({ data: { orderId, batchId, plantsSent: plants, sentOn: dbDate(sentOn), enteredBy: me.userId } });
  const total = sent + plants;
  await tx.salesOrder.update({
    where: { orderId },
    data: {
      ...(total >= Math.max(o.plantsPromised, 1) && total >= o.plantsOrdered ? { status: 'DELIVERED' as const } : {}),
      ...(total > o.plantsPromised ? { plantsPromised: total } : {}),
    },
  });
  return { orderCode: o.orderCode, batchCode: b.batchCode };
}
