// SAMPLE DATA used to fill the in-browser database the first time the app opens.
// Replaced by the real backend later.
import { addDays, today } from './apiUtil';
import type {
  Alert, AlertRule, Area, Attendance, AttStatus, Batch, Bench, Contamination, CostEntry, CostHeading, Crop, Delivery, Item, Lab, MediaLot,
  MediaRecipe, ProductionEntry, SalesOrder, Sample, SensorDevice, Settings, Stage, StockTxn, AuditEntry, Tray, TrayMovement, User, WorkAssignment,
} from './types';

/** Demo password for every sample account. */
export const DEMO_PASSWORD = '1234';

const lab: Lab = { labId: 1, name: 'Demo Tissue Culture Lab', address: 'Jalgaon, Maharashtra', phone: '0257 2000000' };

const areas: Area[] = [
  { areaId: 1, labId: 1, name: 'Washing', areaType: 'WASH', roomNo: 'G-01' },
  { areaId: 2, labId: 1, name: 'Media preparation', areaType: 'MEDIA', roomNo: 'G-02' },
  { areaId: 3, labId: 1, name: 'Inoculation', areaType: 'INOCULATION', roomNo: '1-01' },
  { areaId: 4, labId: 1, name: 'Incubation (growth room)', areaType: 'INCUBATION', roomNo: '1-02' },
  { areaId: 5, labId: 1, name: 'Hardening', areaType: 'HARDENING', roomNo: 'Poly-house' },
];

const benches: Bench[] = [
  ...[1, 2].map((n) => ({ benchId: n, areaId: 1, code: `W-${n}`, capacityTrays: 20 })),
  ...[1, 2].map((n) => ({ benchId: 2 + n, areaId: 2, code: `MP-${n}`, capacityTrays: 30 })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ benchId: 4 + n, areaId: 3, code: `LAF-${n}`, capacityTrays: 10 })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ benchId: 10 + n, areaId: 4, code: `RACK-${n}`, capacityTrays: 60 })),
  ...[1, 2, 3].map((n) => ({ benchId: 18 + n, areaId: 5, code: `PH-${n}`, capacityTrays: 120 })),
];

const users: User[] = [
  { userId: 1, fullName: 'R. Patil', role: 'MANAGER', phone: '9000000001', homeAreaId: null, zoneIds: [], status: 'ACTIVE' },
  { userId: 2, fullName: 'Supervisor A', role: 'SUPERVISOR', phone: '9000000002', homeAreaId: 1, zoneIds: [1, 2], status: 'ACTIVE' },
  { userId: 3, fullName: 'Supervisor B', role: 'SUPERVISOR', phone: '9000000003', homeAreaId: 3, zoneIds: [3, 4], status: 'ACTIVE' },
  { userId: 4, fullName: 'Asha', role: 'OPERATOR', phone: '9000000004', homeAreaId: 3, zoneIds: [], status: 'ACTIVE' },
  { userId: 5, fullName: 'Ravi', role: 'OPERATOR', phone: '9000000005', homeAreaId: 3, zoneIds: [], status: 'ACTIVE' },
  { userId: 6, fullName: 'Meena', role: 'OPERATOR', phone: '9000000006', homeAreaId: 3, zoneIds: [], status: 'ACTIVE' },
  { userId: 7, fullName: 'Suresh', role: 'OPERATOR', phone: '9000000007', homeAreaId: 3, zoneIds: [], status: 'ACTIVE' },
  { userId: 8, fullName: 'Pooja', role: 'OPERATOR', phone: '9000000008', homeAreaId: 3, zoneIds: [], status: 'ACTIVE' },
  { userId: 9, fullName: 'Kiran', role: 'OPERATOR', phone: '9000000009', homeAreaId: 1, zoneIds: [], status: 'ACTIVE' },
];

const crops: Crop[] = [
  { cropId: 1, name: 'Banana', variety: 'G-9 (Grand Naine)', defaultGrowth: 2.8 },
  { cropId: 2, name: 'Banana', variety: 'Robusta', defaultGrowth: 2.6 },
];

const stages: Stage[] = [
  ...[1, 2, 3].map((n) => ({ stageId: n, code: `I${n}`, phase: 'INITIATION' as const, seqNo: n, minDays: 30, maxDays: 45 })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ stageId: 3 + n, code: `M${n}`, phase: 'MULTIPLICATION' as const, seqNo: 3 + n, minDays: 30, maxDays: 45 })),
  { stageId: 12, code: 'R1', phase: 'ROOTING', seqNo: 12, minDays: 30, maxDays: 45 },
  { stageId: 13, code: 'R2', phase: 'ROOTING', seqNo: 13, minDays: 30, maxDays: 45 },
  { stageId: 14, code: 'PH', phase: 'HARDENING', seqNo: 14, minDays: 30, maxDays: 45 },
  { stageId: 15, code: 'SH', phase: 'HARDENING', seqNo: 15, minDays: 60, maxDays: 90 },
];

const recipes: MediaRecipe[] = [
  { recipeId: 1, code: 'MU1', phase: 'MULTIPLICATION', shelfLifeDays: 3, notes: '' },
  { recipeId: 2, code: 'MU2', phase: 'MULTIPLICATION', shelfLifeDays: 3, notes: '' },
  { recipeId: 3, code: 'MU3', phase: 'MULTIPLICATION', shelfLifeDays: 3, notes: '' },
  { recipeId: 4, code: 'RO1', phase: 'ROOTING', shelfLifeDays: 3, notes: '' },
  { recipeId: 5, code: 'RO2', phase: 'ROOTING', shelfLifeDays: 3, notes: '' },
  { recipeId: 6, code: 'RO3', phase: 'ROOTING', shelfLifeDays: 3, notes: '' },
];

const alertRules: AlertRule[] = [
  { ruleId: 1, code: 'TRAY_OVERDUE', label: 'Tray too long in one stage', unit: 'days', direction: 'ABOVE', warnValue: 30, criticalValue: 45, notifyRole: 'SUPERVISOR' },
  { ruleId: 2, code: 'ROOM_TEMP_HIGH', label: 'Room temperature high', unit: '°C', direction: 'ABOVE', warnValue: 27, criticalValue: 29, notifyRole: 'SUPERVISOR' },
  { ruleId: 3, code: 'ROOM_TEMP_LOW', label: 'Room temperature low', unit: '°C', direction: 'BELOW', warnValue: 21, criticalValue: 19, notifyRole: 'SUPERVISOR' },
  { ruleId: 4, code: 'HUMIDITY_HIGH', label: 'Room humidity high', unit: '%', direction: 'ABOVE', warnValue: 80, criticalValue: 90, notifyRole: 'SUPERVISOR' },
  { ruleId: 5, code: 'LOW_OUTPUT', label: 'Operator below target', unit: '% of target', direction: 'BELOW', warnValue: 85, criticalValue: 70, notifyRole: 'SUPERVISOR' },
  { ruleId: 6, code: 'HIGH_LOSS', label: 'Contamination loss high', unit: '% of handled', direction: 'ABOVE', warnValue: 5, criticalValue: 10, notifyRole: 'MANAGER' },
  { ruleId: 7, code: 'DEVICE_OFFLINE', label: 'IoT node not sending', unit: 'minutes', direction: 'ABOVE', warnValue: 10, criticalValue: 30, notifyRole: 'MANAGER' },
  { ruleId: 8, code: 'HARDENING_CHECK', label: 'Hardening lot due for check', unit: 'days', direction: 'ABOVE', warnValue: 25, criticalValue: null, notifyRole: 'MANAGER' },
  { ruleId: 9, code: 'LOW_STOCK', label: 'Stock low', unit: '% of reorder level', direction: 'BELOW', warnValue: 100, criticalValue: 50, notifyRole: 'SUPERVISOR' },
];

// Alerts are raised by the alert checks (lib/alertEngine.ts) from the data itself.
// The one below matches the warm spell in yesterday's sample sensor readings, already acknowledged.
const alerts: Alert[] = [];


// ---------------- production sample data (dates are relative to today) ----------------
const day = (n: number) => addDays(today(), -n);
const stageId = (code: string) => stages.find((s) => s.code === code)!.stageId;
const benchId = (code: string) => benches.find((b) => b.code === code)!.benchId;

const batches: Batch[] = [
  { batchId: 1, batchCode: 'B1-26', cropId: 1, parentBatchId: null, startDate: day(300), status: 'RUNNING' },
  { batchId: 2, batchCode: 'B3-26', cropId: 1, parentBatchId: null, startDate: day(240), status: 'RUNNING' },
  { batchId: 3, batchCode: 'B7-26', cropId: 1, parentBatchId: null, startDate: day(120), status: 'RUNNING' },
  { batchId: 4, batchCode: 'B9-26', cropId: 2, parentBatchId: null, startDate: day(60), status: 'RUNNING' },
  { batchId: 5, batchCode: 'B1-26A', cropId: 1, parentBatchId: 1, startDate: day(25), status: 'RUNNING' },
  { batchId: 6, batchCode: 'B2-26', cropId: 1, parentBatchId: null, startDate: day(270), status: 'RUNNING' },
  // Finished batch whose plants were sent in the last three months (see deliveries).
  { batchId: 7, batchCode: 'B10-25', cropId: 1, parentBatchId: null, startDate: day(390), status: 'CLOSED' },
];

const samples: Sample[] = [
  { sampleId: 1, batchId: 1, sampleType: 'Sword sucker shoot tip', noOfSamples: 10, sampleSize: 3, sourceFarm: 'Patil farm, Raver', collectedAt: day(300) + 'T08:30:00' },
  { sampleId: 2, batchId: 2, sampleType: 'Sword sucker shoot tip', noOfSamples: 12, sampleSize: 3, sourceFarm: 'Mahajan farm, Yawal', collectedAt: day(240) + 'T09:00:00' },
  { sampleId: 3, batchId: 3, sampleType: 'Sword sucker shoot tip', noOfSamples: 8, sampleSize: 2, sourceFarm: 'Patil farm, Raver', collectedAt: day(120) + 'T08:45:00' },
  { sampleId: 4, batchId: 4, sampleType: 'Sword sucker shoot tip', noOfSamples: 6, sampleSize: 2, sourceFarm: 'Chaudhari farm, Chopda', collectedAt: day(60) + 'T10:00:00' },
  { sampleId: 5, batchId: 6, sampleType: 'Sword sucker shoot tip', noOfSamples: 10, sampleSize: 3, sourceFarm: 'Mahajan farm, Yawal', collectedAt: day(270) + 'T09:15:00' },
];

const trays: Tray[] = [];
let trayNo = 0;
/** Adds trays of up to 30 bottles for one batch, stage and bench. */
function addTrays(batchId: number, code: string, stage: string, bench: string, bottles: number, placedDaysAgo: number) {
  const seq = trays.filter((t) => t.batchId === batchId).length;
  let left = bottles;
  let k = 0;
  while (left > 0) {
    const n = Math.min(30, left);
    trayNo += 1;
    k += 1;
    trays.push({
      trayId: trayNo, qrCode: `${code}-${String(seq + k).padStart(4, '0')}`, batchId, stageId: stageId(stage),
      benchId: benchId(bench), mediaLotId: null, bottleCount: n, startBottles: n, placedOn: day(placedDaysAgo), status: 'ACTIVE',
    });
    left -= n;
  }
}
addTrays(1, 'B1-26', 'M6', 'RACK-1', 90, 34); // 3 trays overdue (more than 30 days)
addTrays(1, 'B1-26', 'M6', 'RACK-1', 510, 20);
addTrays(1, 'B1-26', 'M6', 'RACK-2', 400, 20);
addTrays(2, 'B3-26', 'R1', 'RACK-4', 1500, 15);
addTrays(2, 'B3-26', 'R1', 'RACK-5', 1260, 15);
addTrays(3, 'B7-26', 'M3', 'RACK-8', 300, 10);
addTrays(4, 'B9-26', 'I2', 'RACK-7', 30, 22);
addTrays(5, 'B1-26A', 'R1', 'RACK-6', 500, 5);
addTrays(6, 'B2-26', 'PH', 'PH-1', 1200, 18);

/** Stage history of each batch (one line per stage change). */
const history: Array<[number, string, string, number, number, number, number]> = [
  // batch, from, to, bottles in, bottles out, lost, days ago
  [1, 'I1', 'I2', 10, 10, 0, 270], [1, 'I2', 'I3', 10, 10, 0, 235], [1, 'I3', 'M1', 10, 10, 0, 200],
  [1, 'M1', 'M2', 10, 20, 0, 165], [1, 'M2', 'M3', 20, 40, 1, 130], [1, 'M3', 'M4', 40, 80, 2, 95],
  [1, 'M4', 'M5', 80, 150, 4, 60], [1, 'M5', 'M6', 150, 400, 6, 40], [1, 'M6', 'M6', 400, 1000, 9, 20],
  [1, 'M6', 'R1', 200, 500, 3, 5],
  [3, 'I1', 'I2', 8, 8, 0, 90], [3, 'I2', 'M1', 8, 20, 0, 55], [3, 'M1', 'M2', 20, 50, 0, 40], [3, 'M2', 'M3', 50, 120, 1, 25], [3, 'M3', 'M3', 120, 300, 4, 10],
  [6, 'M8', 'R1', 400, 1100, 12, 75], [6, 'R1', 'R2', 1100, 1150, 20, 45], [6, 'R2', 'PH', 1150, 1200, 18, 18],
];
const movements: TrayMovement[] = history.map(([b, from, to, bin, bout, lost, ago], i) => ({
  movementId: i + 1, batchId: b, trayId: 0, newTrayIds: [], fromStageId: stageId(from), toStageId: stageId(to),
  fromBenchId: 0, toBenchId: 0, bottlesIn: bin, bottlesOut: bout, bottlesLost: lost, movedBy: 3, movedAt: day(ago) + 'T17:30:00',
}));

const contaminations: Contamination[] = [
  { contId: 1, trayId: 4, bottlesLost: 4, cause: 'OPERATOR', contType: 'FUNGAL', foundOn: day(12), reportedBy: 3, note: '' },
  { contId: 2, trayId: 6, bottlesLost: 6, cause: 'LAB', contType: 'BACTERIAL', foundOn: day(9), reportedBy: 3, note: 'Near door of growth room' },
  { contId: 3, trayId: 40, bottlesLost: 8, cause: 'MEDIA', contType: 'FUNGAL', foundOn: day(7), reportedBy: 3, note: 'Same media lot in 3 trays' },
  { contId: 4, trayId: 41, bottlesLost: 5, cause: 'MEDIA', contType: 'FUNGAL', foundOn: day(7), reportedBy: 3, note: '' },
  { contId: 5, trayId: 70, bottlesLost: 3, cause: 'OPERATOR', contType: 'BACTERIAL', foundOn: day(4), reportedBy: 3, note: '' },
  { contId: 6, trayId: 132, bottlesLost: 2, cause: 'SEASON', contType: 'OTHER', foundOn: day(3), reportedBy: 3, note: 'Browning' },
];
for (const c of contaminations) {
  const t = trays.find((x) => x.trayId === c.trayId);
  if (t) t.bottleCount = Math.max(0, t.bottleCount - c.bottlesLost);
}


// ---------------- daily work sample data (last 95 days, Sundays off) ----------------
// The last 12 days have one entry per tray; older days are kept as one summary entry per operator per day.
/** Same "random" number every time for the same inputs, so the sample data does not change on reload. */
const rnd = (...k: number[]) => {
  let h = 7;
  for (const x of k) h = (h * 31 + x * 17) % 9973;
  return (h % 1000) / 1000;
};
const attendance: Attendance[] = [];
const assignments: WorkAssignment[] = [];
const entries: ProductionEntry[] = [];
/** Each zone-3 operator's usual work: batch, stage, bench (hood), daily target, how well they usually do. */
const plan: Record<number, { batchId: number; stage: string; bench: string; target: number; pace: number }> = {
  4: { batchId: 1, stage: 'M6', bench: 'LAF-1', target: 180, pace: 1.0 }, // Asha
  5: { batchId: 2, stage: 'R1', bench: 'LAF-2', target: 240, pace: 0.95 }, // Ravi
  6: { batchId: 3, stage: 'M3', bench: 'LAF-3', target: 150, pace: 0.92 }, // Meena
  7: { batchId: 1, stage: 'M6', bench: 'LAF-4', target: 180, pace: 0.74 }, // Suresh, often below target
  8: { batchId: 5, stage: 'R1', bench: 'LAF-5', target: 200, pace: 0.97 }, // Pooja
};
const growthOfStage = (code: string) => (code.startsWith('M') ? 2.5 : 1);
for (let ago = 95; ago >= 0; ago--) {
  const date = day(ago);
  if (new Date(date + 'T12:00:00').getDay() === 0) continue; // Sunday
  for (const u of users.filter((x) => x.role === 'OPERATOR')) {
    if (ago === 0 && u.userId === 9) continue; // Kiran: not marked yet today
    const r = rnd(u.userId, ago);
    let status: AttStatus = r < 0.08 ? 'A' : r < 0.14 ? 'HD' : 'P';
    if (ago === 0) status = ({ 4: 'P', 5: 'P', 6: 'HD', 7: 'P', 8: 'A' } as Record<number, AttStatus>)[u.userId] ?? 'P';
    attendance.push({ attId: attendance.length + 1, userId: u.userId, workDate: date, status, markedBy: u.homeAreaId === 1 ? 2 : 3 });
    const p = plan[u.userId];
    if (!p || status === 'A') continue;
    const target = status === 'HD' ? p.target / 2 : p.target;
    const a: WorkAssignment = {
      assignId: assignments.length + 1, workDate: date, operatorId: u.userId, batchId: p.batchId, stageId: stageId(p.stage),
      benchId: benchId(p.bench), targetBottles: target, assignedBy: 3,
    };
    assignments.push(a);
    if (ago === 0 && u.userId !== 5) continue; // today only Ravi has started
    const batchTrays = trays.filter((t) => t.batchId === p.batchId && t.stageId === a.stageId);
    let handled = ago === 0 ? 60 : Math.round(target * (p.pace + (rnd(ago, u.userId, 3) - 0.5) * 0.12));
    let k = 0;
    while (handled > 0 && batchTrays.length) {
      const n = ago > 12 ? handled : Math.min(30, handled);
      const lost = rnd(u.userId, ago, k) < 0.25 ? 1 + Math.floor(rnd(k, ago) * 2) : 0;
      const t = batchTrays[(ago * 7 + k + u.userId) % batchTrays.length];
      entries.push({
        entryId: entries.length + 1, assignId: a.assignId, operatorId: u.userId, trayId: t.trayId, movementId: null, contId: null, workDate: date,
        bottlesHandled: n, bottlesProduced: Math.round((n - lost) * growthOfStage(p.stage)), bottlesLost: lost,
        status: ago <= 1 ? 'PENDING' : 'VERIFIED', enteredAt: `${date}T${String(10 + Math.floor(k / 2)).padStart(2, '0')}:${k % 2 ? '40' : '10'}:00`,
        verifiedBy: ago <= 1 ? null : 3, verifiedAt: ago <= 1 ? null : `${date}T18:30:00`, note: '',
      });
      handled -= n;
      k++;
    }
  }
}

// ---------------- stock, media, costs, orders sample data (Phase 5) ----------------
const items: Item[] = [
  { itemId: 1, name: 'MS medium powder', category: 'CHEMICAL', unit: 'pack', stockQty: 14, reorderLevel: 5 },
  { itemId: 2, name: 'Sucrose', category: 'CHEMICAL', unit: 'kg', stockQty: 38, reorderLevel: 15 },
  { itemId: 3, name: 'Agar', category: 'CHEMICAL', unit: 'kg', stockQty: 2, reorderLevel: 5 },
  { itemId: 4, name: 'BAP', category: 'CHEMICAL', unit: 'g', stockQty: 18, reorderLevel: 5 },
  { itemId: 5, name: 'IBA', category: 'CHEMICAL', unit: 'g', stockQty: 9, reorderLevel: 3 },
  { itemId: 6, name: 'Activated charcoal', category: 'CHEMICAL', unit: 'kg', stockQty: 4, reorderLevel: 2 },
  { itemId: 7, name: 'Sodium hypochlorite', category: 'CHEMICAL', unit: 'L', stockQty: 6, reorderLevel: 5 },
  { itemId: 8, name: 'Ethanol 70%', category: 'CHEMICAL', unit: 'L', stockQty: 12, reorderLevel: 10 },
  { itemId: 9, name: 'Culture bottles', category: 'CONSUMABLE', unit: 'pcs', stockQty: 4200, reorderLevel: 2000 },
  { itemId: 10, name: 'Bottle lids', category: 'CONSUMABLE', unit: 'pcs', stockQty: 1800, reorderLevel: 2000 },
  { itemId: 11, name: 'Cocopeat', category: 'HARDENING', unit: 'kg', stockQty: 350, reorderLevel: 100 },
  { itemId: 12, name: 'Polybags', category: 'HARDENING', unit: 'pcs', stockQty: 6000, reorderLevel: 3000 },
];

const recipeId = (code: string) => recipes.find((r) => r.code === code)!.recipeId;
const mediaLots: MediaLot[] = [];
const stockTxns: StockTxn[] = [];
const txn = (itemId: number, txnType: StockTxn['txnType'], qty: number, ago: number, note: string, mediaLotId: number | null = null, doneBy = 2) =>
  stockTxns.push({ txnId: stockTxns.length + 1, itemId, txnType, qty, mediaLotId, txnDate: day(ago), doneBy, note });
/** Media lots made in the last week. Recipe shelf life comes from Set-up, so older lots show as expired. */
const lotPlan: Array<[string, number, number, number]> = [
  // recipe, days ago, litres, bottles filled
  ['MU1', 6, 20, 400], ['RO1', 5, 15, 300], ['MU2', 3, 20, 400], ['MU1', 1, 20, 400], ['RO1', 1, 15, 300], ['MU1', 0, 10, 200],
];
for (const [code, ago, litres, bottles] of lotPlan) {
  const r = recipes.find((x) => x.code === code)!;
  const id = mediaLots.length + 1;
  const prepared = day(ago);
  const n = mediaLots.filter((l) => l.recipeId === r.recipeId && l.preparedOn === prepared).length;
  mediaLots.push({
    mediaLotId: id, lotCode: `${code}-${prepared.slice(8, 10)}${prepared.slice(5, 7)}${n ? String.fromCharCode(65 + n) : ''}`, recipeId: recipeId(code),
    preparedOn: prepared, volumeLitre: litres, bottlesFilled: bottles, expiresOn: addDays(prepared, r.shelfLifeDays), preparedBy: 2,
  });
  // chemicals used for this lot (sample quantities)
  txn(1, 'OUT', litres / 10, ago, 'For media', id);
  txn(2, 'OUT', litres * 0.03, ago, 'For media', id);
  txn(3, 'OUT', litres * 0.007, ago, 'For media', id);
  txn(code.startsWith('MU') ? 4 : 5, 'OUT', litres * 0.05, ago, 'For media', id);
  txn(9, 'OUT', bottles, ago, 'For media', id);
}
txn(2, 'IN', 25, 20, 'Received', null, 1);
txn(9, 'IN', 3000, 15, 'Received', null, 1);
txn(8, 'OUT', 5, 4, 'Cleaning the hoods');
txn(10, 'ADJ', -40, 2, 'Stock count: broken lids');
// some B1-26A rooting trays were filled from rooting lot RO1 (so media traceability shows on those trays)
for (const t of trays.filter((x) => x.batchId === 5).slice(0, 4)) t.mediaLotId = 2;

/** Monthly cost totals for the last three finished months (sample figures for the demo lab). */
const costs: CostEntry[] = [];
const thisMonth = today().slice(0, 7);
const monthBack = (n: number) => {
  const [y, m] = thisMonth.split('-').map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const costPlan: Record<CostHeading, number[]> = {
  // three months back, two back, last month
  LABOUR: [24000, 24000, 25500],
  CHEMICALS: [7800, 8400, 8100],
  CONSUMABLES: [5200, 5600, 5900],
  POWER: [6900, 7400, 7100],
  HARDENING: [3100, 3300, 3600],
  OTHER: [1200, 800, 1500],
};
for (const [heading, amounts] of Object.entries(costPlan) as [CostHeading, number[]][]) {
  amounts.forEach((amount, i) => costs.push({ costId: costs.length + 1, month: monthBack(3 - i), heading, amount, enteredBy: 1 }));
}

const orders: SalesOrder[] = [
  { orderId: 1, orderCode: 'O-101', customerName: 'Patil Agro, Raver', phone: '9822000011', cropId: 1, plantsOrdered: 600, ratePerPlant: 16, requiredBy: day(-100), decision: 'YES', plantsPromised: 600, status: 'OPEN', createdAt: day(20) + 'T11:00:00', createdBy: 1 },
  { orderId: 2, orderCode: 'O-102', customerName: 'Mahajan Farms', phone: '9822000022', cropId: 1, plantsOrdered: 3000, ratePerPlant: 15, requiredBy: day(-180), decision: 'PARTLY', plantsPromised: 2400, status: 'OPEN', createdAt: day(12) + 'T15:30:00', createdBy: 1 },
  { orderId: 3, orderCode: 'O-103', customerName: 'Chaudhari, Chopda', phone: '9822000033', cropId: 2, plantsOrdered: 1500, ratePerPlant: 17, requiredBy: day(-60), decision: 'NO', plantsPromised: 0, status: 'OPEN', createdAt: day(6) + 'T10:15:00', createdBy: 1 },
];
// Three earlier orders, already delivered from the finished batch B10-25 (one per past month).
const deliveries: Delivery[] = [];
[[3200, 15.5, 80], [3400, 15.5, 50], [3600, 16, 20]].forEach(([plants, rate, ago], i) => {
  const orderId = 4 + i;
  const sentOn = day(ago);
  orders.push({
    orderId, orderCode: `O-09${7 + i}`, customerName: ['Sharma Nursery, Jalgaon', 'Patil Agro, Raver', 'Mahajan Farms'][i], phone: '', cropId: 1,
    plantsOrdered: plants, ratePerPlant: rate, requiredBy: sentOn, decision: 'YES', plantsPromised: plants, status: 'DELIVERED',
    createdAt: day(ago + 100) + 'T11:00:00', createdBy: 1,
  });
  deliveries.push({ deliveryId: i + 1, orderId, batchId: 7, plantsSent: plants, sentOn, enteredBy: 1 });
});

const settings: Settings = { rootingSurvival: 0.9, hardeningSurvival: 0.85, lastMultiplicationStage: 'M8', defaultRate: 15 };

// ---------------- results sample data (Phase 6) ----------------
const devices: SensorDevice[] = [{ deviceId: 1, name: 'Growth room node (ESP32 + DHT22)', areaId: 4, intervalMin: 5 }];
alerts.push({
  alertId: 1, code: 'ROOM_TEMP_HIGH', areaId: 4, severity: 'WARNING', message: 'Growth room above 27 °C for 50 minutes (highest 28.6 °C)',
  createdAt: day(1) + 'T02:15:00', ackAt: day(1) + 'T08:05:00', ackBy: 3, key: 'ROOM_TEMP_HIGH:' + day(1),
});
const audit: AuditEntry[] = [];

export const SEED = {
  lab,
  areas,
  benches,
  users,
  /** Passwords by userId. Only in the fake API; the real backend stores hashes. */
  passwords: Object.fromEntries(users.map((u) => [u.userId, DEMO_PASSWORD])) as Record<number, string>,
  crops,
  stages,
  recipes,
  alertRules,
  alerts,
  batches,
  samples,
  trays,
  movements,
  contaminations,
  attendance,
  assignments,
  entries,
  items,
  stockTxns,
  mediaLots,
  costs,
  orders,
  deliveries,
  settings,
  devices,
  audit,
};

/** One sample account per role, shown on the login page. */
export const DEMO_USERS = [users[0], users[2], users[3]];
