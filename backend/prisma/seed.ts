// Fills the database with the same sample lab the website uses (frontend/src/lib/mockData.ts),
// so the database and the website start from identical data. Safe to run again: it empties the tables first.
//   npm run db:seed
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { DEMO_PASSWORD, SEED } from '../../frontend/src/lib/mockData';
import { ID_TABLES, fixIdCounters } from './idCounters';

const prisma = new PrismaClient();

/** 'YYYY-MM-DD' → a date-only value. */
const d = (s: string) => new Date(s + 'T00:00:00Z');
/** 'YYYY-MM-DDTHH:mm:ss' (lab time) → a timestamp. */
const ts = (s: string) => new Date(s);
const orNull = <T>(x: T | undefined | null) => (x === undefined ? null : x);

/** Table name and its id column, in the order rows are inserted (parents before children). */
const TABLES = ID_TABLES;

/** Inserts many rows in chunks (a single insert of thousands of rows is too big for one request). */
async function insert<T>(name: string, rows: T[], create: (data: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 1000) await create(rows.slice(i, i + 1000));
  console.log(`  ${name.padEnd(18)} ${rows.length}`);
}

async function main() {
  const S = SEED;
  console.log('Emptying tables …');
  const all = [...new Set([...TABLES.map(([t]) => t), 'user_zone', 'auth_session', 'password_reset', 'sensor_reading', 'settings'])];
  await prisma.$executeRawUnsafe(`TRUNCATE ${all.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  console.log('Adding sample data …');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await insert('lab', [S.lab], (rows) => prisma.lab.createMany({ data: rows }));
  await insert('area', S.areas, (rows) => prisma.area.createMany({ data: rows }));
  await insert('bench', S.benches, (rows) => prisma.bench.createMany({ data: rows }));
  await insert('app_user', S.users, (rows) => prisma.user.createMany({
    data: rows.map((u) => ({ userId: u.userId, fullName: u.fullName, role: u.role, phone: u.phone, passwordHash: hash, homeAreaId: u.homeAreaId, status: u.status })),
  }));
  const links = S.users.flatMap((u) => u.zoneIds.map((areaId) => ({ userId: u.userId, areaId })));
  await insert('user_zone', links, (rows) => prisma.userZone.createMany({ data: rows }));
  await insert('crop', S.crops, (rows) => prisma.crop.createMany({ data: rows }));
  await insert('stage', S.stages, (rows) => prisma.stage.createMany({ data: rows }));
  await insert('media_recipe', S.recipes, (rows) => prisma.mediaRecipe.createMany({ data: rows }));
  await insert('alert_rule', S.alertRules, (rows) => prisma.alertRule.createMany({ data: rows }));
  await prisma.settings.create({ data: { settingsId: 1, ...S.settings, defaultRate: orNull(S.settings.defaultRate) } });

  await insert('batch', S.batches, (rows) => prisma.batch.createMany({ data: rows.map((b) => ({ ...b, startDate: d(b.startDate) })) }));
  await insert('sample', S.samples, (rows) => prisma.sample.createMany({ data: rows.map((s) => ({ ...s, collectedAt: ts(s.collectedAt) })) }));
  await insert('media_lot', S.mediaLots, (rows) => prisma.mediaLot.createMany({
    data: rows.map((l) => ({ ...l, preparedOn: d(l.preparedOn), expiresOn: d(l.expiresOn) })),
  }));
  await insert('tray', S.trays, (rows) => prisma.tray.createMany({
    data: rows.map((t) => ({ ...t, startBottles: orNull(t.startBottles), placedOn: d(t.placedOn) })),
  }));
  await insert('tray_movement', S.movements, (rows) => prisma.trayMovement.createMany({
    data: rows.map((m) => ({
      ...m, trayId: m.trayId || null, fromBenchId: m.fromBenchId || null, toBenchId: m.toBenchId || null,
      takenTrayIds: m.takenTrayIds ?? [], movedAt: ts(m.movedAt),
    })),
  }));
  await insert('contamination', S.contaminations, (rows) => prisma.contamination.createMany({ data: rows.map((c) => ({ ...c, foundOn: d(c.foundOn) })) }));
  await insert('attendance', S.attendance, (rows) => prisma.attendance.createMany({ data: rows.map((a) => ({ ...a, workDate: d(a.workDate) })) }));
  await insert('work_assignment', S.assignments, (rows) => prisma.workAssignment.createMany({
    data: rows.map((a) => ({
      ...a, workDate: d(a.workDate), kind: a.kind ?? 'SUBCULTURE', areaId: orNull(a.areaId), targetContaminated: a.targetContaminated ?? 0,
      recipeId: orNull(a.recipeId), mediaBatchCode: orNull(a.mediaBatchCode),
    })),
  }));
  await insert('production_entry', S.entries, (rows) => prisma.productionEntry.createMany({
    data: rows.map((e) => ({
      ...e, workDate: d(e.workDate), enteredAt: ts(e.enteredAt), verifiedAt: e.verifiedAt ? ts(e.verifiedAt) : null,
      kind: e.kind ?? 'SUBCULTURE', source: e.source ?? (e.trayId !== null ? 'QR' : 'MANUAL'),
      batchId: orNull(e.batchId), stageId: orNull(e.stageId), areaId: orNull(e.areaId), mediaLotId: orNull(e.mediaLotId),
      enteredBy: orNull(e.enteredBy), contaminated: e.contaminated ?? 0,
      taken: e.taken ? (e.taken as Prisma.InputJsonValue) : Prisma.JsonNull,
    })),
  }));
  await insert('item', S.items, (rows) => prisma.item.createMany({ data: rows }));
  await insert('stock_txn', S.stockTxns, (rows) => prisma.stockTxn.createMany({ data: rows.map((t) => ({ ...t, txnDate: d(t.txnDate) })) }));
  await insert('cost_entry', S.costs, (rows) => prisma.costEntry.createMany({ data: rows }));
  await insert('sales_order', S.orders, (rows) => prisma.salesOrder.createMany({
    data: rows.map((o) => ({ ...o, requiredBy: d(o.requiredBy), createdAt: ts(o.createdAt) })),
  }));
  await insert('delivery', S.deliveries, (rows) => prisma.delivery.createMany({ data: rows.map((x) => ({ ...x, sentOn: d(x.sentOn) })) }));
  await insert('sensor_device', S.devices, (rows) => prisma.sensorDevice.createMany({ data: rows }));
  await insert('alert', S.alerts, (rows) => prisma.alert.createMany({
    data: rows.map((a) => ({
      ...a, createdAt: ts(a.createdAt), ackAt: a.ackAt ? ts(a.ackAt) : null, ackBy: orNull(a.ackBy), key: orNull(a.key), userId: orNull(a.userId),
    })),
  }));

  // Rows were added with their sample ids, so move each id counter past the highest id used.
  await fixIdCounters(prisma);
  console.log(`Done. Every sample account uses the password ${DEMO_PASSWORD}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
