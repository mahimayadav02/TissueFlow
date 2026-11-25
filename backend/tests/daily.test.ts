// Daily work against the real database: attendance, giving work, recording work, checking entries, output.
// Uses its own test batch and puts everything back at the end. Run: npm test
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '../src/db/prisma.js';
import { PHONES, call, start, stop, tokenFor } from './helpers.js';

const LAF1 = 5, LAF2 = 6; // hoods in Inoculation (zone 3)
const RACK1 = 11; // growth room (zone 4)
const I1 = 1, I2 = 2;
const ASHA = 4, RAVI = 5, MEENA = 6, KIRAN = 9;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const tomorrow = new Date(Date.parse(today) + 864e5).toISOString().slice(0, 10);
const dbDay = (d: string) => new Date(`${d}T00:00:00Z`);

let mgr = '', asha = '', kiran = '', supA = '', supB = '';
let batchId = 0;
const made = { assignIds: [] as number[], entryIds: [] as number[], lotIds: [] as number[] };
const attBefore = new Map<number, { status: 'P' | 'HD' | 'A'; markedBy: number } | null>();

before(async () => {
  await start();
  [mgr, asha, kiran, supA, supB] = await Promise.all([PHONES.manager, PHONES.asha, PHONES.kiran, PHONES.supervisorA, PHONES.supervisorB].map((p) => tokenFor(p)));
  for (const userId of [ASHA, KIRAN]) {
    const a = await prisma.attendance.findUnique({ where: { userId_workDate: { userId, workDate: dbDay(today) } } });
    attBefore.set(userId, a ? { status: a.status, markedBy: a.markedBy } : null);
  }
  // A test batch: 65 bottles at I1 on hood LAF-1, in trays of 30, 30 and 5.
  const r = await call('/batches', {
    token: mgr,
    body: { cropId: 1, startDate: today, bottles: 65, benchId: LAF1, samples: [{ sampleType: 'Sucker', noOfSamples: 1, sampleSize: 1, sourceFarm: 'Test', collectedAt: new Date().toISOString() }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  batchId = r.body.batchId;
});

after(async () => {
  const mine = { batchId };
  await prisma.productionEntry.deleteMany({ where: { OR: [mine, { entryId: { in: made.entryIds } }] } });
  await prisma.workAssignment.deleteMany({ where: { OR: [mine, { assignId: { in: made.assignIds } }] } });
  await prisma.mediaLot.deleteMany({ where: { mediaLotId: { in: made.lotIds } } });
  await prisma.contamination.deleteMany({ where: { tray: mine } });
  await prisma.trayMovement.deleteMany({ where: mine });
  await prisma.tray.deleteMany({ where: mine });
  await prisma.sample.deleteMany({ where: mine });
  await prisma.batch.deleteMany({ where: { batchId } });
  for (const [userId, a] of attBefore) {
    const key = { userId_workDate: { userId, workDate: dbDay(today) } };
    if (a) await prisma.attendance.update({ where: key, data: a });
    else await prisma.attendance.deleteMany({ where: { userId, workDate: dbDay(today) } });
  }
  await stop();
});

test('attendance: supervisors mark people in their own zones only', async () => {
  assert.equal((await call('/daily/attendance', { token: asha })).status, 403, 'operators cannot open the attendance sheet');
  const sheet = await call(`/daily/attendance?date=${today}`, { token: supB });
  assert.equal(sheet.status, 200);
  assert.ok(sheet.body.some((r: any) => r.userId === ASHA));
  assert.ok(!sheet.body.some((r: any) => r.userId === KIRAN), 'zone 1 operator is not on zone 3 supervisor’s sheet');
  assert.equal((await call('/daily/attendance', { token: supA, body: { date: today, marks: [{ userId: ASHA, status: 'P' }] } })).status, 403);
  assert.equal((await call('/daily/attendance', { token: supB, body: { date: tomorrow, marks: [{ userId: ASHA, status: 'P' }] } })).status, 400, 'not for a future date');
  assert.equal((await call('/daily/attendance', { token: supB, body: { date: today, marks: [{ userId: ASHA, status: 'P' }] } })).status, 200);
  assert.equal((await call('/daily/attendance', { token: supA, body: { date: today, marks: [{ userId: KIRAN, status: 'P' }] } })).status, 200);
  const me = await call('/daily/today-attendance', { token: asha });
  assert.equal(me.body.status, 'P');
});

test('giving work: bottles cannot be given out twice, and a hood takes at most 2 operators', async () => {
  const line = (operatorId: number, targetBottles: number, benchId: number | null = null) =>
    call('/daily/assignments', { token: supB, body: { workDate: tomorrow, operatorId, areaId: 3, kind: 'SUBCULTURE', batchId, stageId: I1, benchId, targetBottles } });
  const a = await line(ASHA, 40, LAF2);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  made.assignIds.push(a.body.assignId);
  assert.equal(a.body.label.endsWith('· I1'), true);
  const tooMany = await line(RAVI, 30, LAF2);
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /Only 25 bottles/);
  const b = await line(RAVI, 20, LAF2);
  assert.equal(b.status, 201);
  made.assignIds.push(b.body.assignId);
  const third = await line(MEENA, 5, LAF2);
  assert.equal(third.status, 400);
  assert.match(third.body.error, /already has 2 operators/);
  assert.equal((await line(ASHA, 5)).status, 400, 'same line twice for one operator');

  assert.equal((await call('/daily/assignments', { token: asha, body: { workDate: tomorrow, operatorId: ASHA, areaId: 3, batchId, stageId: I1, targetBottles: 1 } })).status, 403);
  const wash = await call('/daily/assignments', { token: supB, body: { workDate: tomorrow, operatorId: ASHA, areaId: 3, kind: 'WASH', targetBottles: 5 } });
  assert.match(wash.body.error, /Washing is not done in Inoculation/);

  const list = await call(`/daily/assignments?date=${tomorrow}`, { token: supB });
  assert.ok(list.body.some((r: any) => r.assignId === a.body.assignId && r.target === 40));
  const opts = await call(`/daily/assign-options?date=${tomorrow}`, { token: supB });
  const st = opts.body.batches.find((x: any) => x.batchId === batchId).stages.find((s: any) => s.stageId === I1);
  assert.equal(st.free, 5, '65 bottles, 60 given out');

  const changed = await call(`/daily/assignments/${b.body.assignId}`, { token: supB, method: 'PUT', body: { workDate: tomorrow, operatorId: RAVI, areaId: 3, batchId, stageId: I1, benchId: LAF2, targetBottles: 25 } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.target, 25);
  assert.equal((await call(`/daily/assignments/${b.body.assignId}`, { token: supA, method: 'DELETE' })).status, 403);
  assert.equal((await call(`/daily/assignments/${b.body.assignId}`, { token: supB, method: 'DELETE' })).status, 200);
});

test('recording a typed-in sub-culture takes bottles from the oldest trays; sending it back puts them back', async () => {
  const body = { operatorId: ASHA, workDate: today, kind: 'SUBCULTURE', batchId, stageId: I1, bottlesHandled: 35, bottlesOut: 70, bottlesLost: 0, toStageId: I2, toBenchId: RACK1 };
  const before = await prisma.tray.findMany({ where: { batchId, stageId: I1 }, orderBy: { trayId: 'asc' } });
  const r = await call('/daily/entries', { token: asha, body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  made.entryIds.push(r.body.entryId);
  assert.equal(r.body.status, 'PENDING');
  assert.equal(r.body.qrCode, '2 trays');
  const mid = await prisma.tray.findMany({ where: { batchId, stageId: I1 }, orderBy: { trayId: 'asc' } });
  assert.deepEqual(mid.map((t) => t.bottleCount), [0, 25, 5]);
  assert.equal(mid[0].status, 'MOVED');
  assert.equal(await prisma.tray.count({ where: { batchId, stageId: I2, status: 'ACTIVE' } }), 3, '70 new bottles in trays of 30, 30, 10');

  const pending = await call('/daily/entries?status=PENDING', { token: supB });
  const row = pending.body.find((e: any) => e.entryId === r.body.entryId);
  assert.ok(row, 'supervisor sees it waiting');
  assert.equal(row.undoable, true);
  assert.equal((await call(`/daily/entries/${r.body.entryId}/reject`, { token: supB, body: { reason: 'no' } })).status, 400, 'reason too short');
  const back = await call(`/daily/entries/${r.body.entryId}/reject`, { token: supB, body: { reason: 'Count does not match the trays' } });
  assert.equal(back.status, 200);
  assert.equal(back.body.undone, true);
  const after = await prisma.tray.findMany({ where: { batchId, stageId: I1 }, orderBy: { trayId: 'asc' } });
  assert.deepEqual(after.map((t) => [t.bottleCount, t.status]), before.map((t) => [t.bottleCount, t.status]));
  assert.equal(await prisma.tray.count({ where: { batchId, stageId: I2 } }), 0, 'new trays removed');
  const sent = await call('/daily/my-sent-back', { token: asha });
  assert.ok(sent.body.some((e: any) => e.entryId === r.body.entryId && e.note === 'Count does not match the trays'));

  const again = await call('/daily/entries', { token: asha, body });
  assert.equal(again.status, 201);
  made.entryIds.push(again.body.entryId);
  assert.equal((await call('/daily/entries/verify', { token: supA, body: { entryIds: [again.body.entryId] } })).status, 403);
  assert.equal((await call('/daily/entries/verify', { token: supB, body: { entryIds: [again.body.entryId] } })).status, 200);
  const done = await prisma.productionEntry.findUniqueOrThrow({ where: { entryId: again.body.entryId } });
  assert.equal(done.status, 'VERIFIED');
});

test('operators record only their own work, only for today; checks on counts', async () => {
  const base = { workDate: today, kind: 'SUBCULTURE', batchId, stageId: I1, bottlesHandled: 5, bottlesLost: 0, toStageId: I2, toBenchId: RACK1 };
  assert.equal((await call('/daily/entries', { token: asha, body: { ...base, operatorId: RAVI, bottlesOut: 10 } })).status, 403);
  assert.match((await call('/daily/entries', { token: asha, body: { ...base, operatorId: ASHA, workDate: tomorrow, bottlesOut: 10 } })).body.error, /today only/);
  assert.match((await call('/daily/entries', { token: asha, body: { ...base, operatorId: ASHA, bottlesOut: 100 } })).body.error, /more than 6 times/);
  assert.match((await call('/daily/entries', { token: asha, body: { ...base, operatorId: ASHA, bottlesOut: 8, bottlesLost: 1 } })).body.error, /cause and type/);
  assert.match((await call('/daily/entries', { token: kiran, body: { ...base, operatorId: KIRAN, bottlesOut: 10 } })).body.error, /Kiran’s zones/, 'sub-culture is not done in her zone');
});

test('washing takes bottles off the wash count', async () => {
  const before = await call('/daily/wash', { token: supA });
  assert.ok(before.body.plain >= 3, 'sample data has bottles waiting');
  const r = await call('/daily/entries', { token: kiran, body: { operatorId: KIRAN, workDate: today, kind: 'WASH', bottlesHandled: 3, contaminated: 0 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  made.entryIds.push(r.body.entryId);
  const after = await call('/daily/wash', { token: supA });
  assert.equal(after.body.plain, before.body.plain - 3);
  const tooMany = await call('/daily/entries', { token: kiran, body: { operatorId: KIRAN, workDate: today, kind: 'WASH', bottlesHandled: after.body.plain + 1 } });
  assert.match(tooMany.body.error, /waiting to be washed/);
});

test('output: day totals with filters; operators see only their own', async () => {
  const sup = await call(`/daily/output?from=${today}&to=${today}`, { token: supB });
  assert.equal(sup.status, 200);
  assert.ok(sup.body.byOperator.some((g: any) => g.filter.operatorId === ASHA && g.handled >= 35));
  const byBatch = await call(`/daily/output?from=${today}&to=${today}&batchId=${batchId}&kind=SUBCULTURE`, { token: mgr });
  assert.equal(byBatch.body.totals.handled, 35, 'only the verified entry; the sent-back one does not count');
  const own = await call(`/daily/output?from=${today}&to=${today}`, { token: asha });
  assert.ok(own.body.byOperator.every((g: any) => g.filter.operatorId === ASHA));
  assert.equal((await call(`/daily/output?from=${tomorrow}&to=${today}`, { token: mgr })).status, 400);
  const my = await call('/daily/my-output?days=7', { token: asha });
  assert.equal(my.status, 200);
  assert.ok(my.body.some((d: any) => d.workDate === today && d.handled >= 35));
  assert.equal((await call('/daily/my-output', { token: supB })).status, 403);
  const board = await call(`/daily/board?date=${today}`, { token: supB });
  assert.ok(board.body.some((r: any) => r.operatorId === ASHA));
  const form = await call(`/daily/entry-options?date=${today}`, { token: asha });
  assert.equal(form.status, 200);
  assert.ok(form.body.batches.some((b: any) => b.batchId === batchId));
});
