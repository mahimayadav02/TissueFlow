// Lab set-up lists: everyone reads, only the manager changes. Run: npm test
// Everything made here is removed at the end.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '../src/db/prisma.js';
import { PHONES, call, rand, start, stop, tokenFor } from './helpers.js';

const made = { cropIds: [] as number[], benchIds: [] as number[], userIds: [] as number[] };
let mgr = '';
let op = '';
let sup = '';

before(async () => {
  await start();
  [mgr, op, sup] = [await tokenFor(PHONES.manager), await tokenFor(PHONES.asha), await tokenFor(PHONES.supervisorA)];
});
after(async () => {
  await prisma.crop.deleteMany({ where: { cropId: { in: made.cropIds } } });
  await prisma.bench.deleteMany({ where: { benchId: { in: made.benchIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: made.userIds } } });
  await prisma.user.deleteMany({ where: { userId: { in: made.userIds } } });
  await stop();
});

test('everyone signed in can read the set-up lists', async () => {
  assert.equal((await call('/setup/areas')).status, 401);
  const areas = await call('/setup/areas', { token: op });
  assert.equal(areas.status, 200);
  assert.ok(areas.body.length >= 6);
  const stages = await call('/setup/stages', { token: op });
  const seq = stages.body.map((s: any) => s.seqNo);
  assert.deepEqual(seq, [...seq].sort((a: number, b: number) => a - b), 'stages come in order');
  for (const p of ['/setup/lab', '/setup/benches', '/setup/crops', '/setup/recipes', '/setup/alert-rules', '/setup/settings']) {
    assert.equal((await call(p, { token: op })).status, 200, p);
  }
});

test('only the manager can change set-up', async () => {
  const crop = { name: `Test crop ${rand()}`, variety: 'T', defaultGrowth: 3 };
  assert.equal((await call('/setup/crops', { token: op, body: crop })).status, 403);
  assert.equal((await call('/setup/crops', { token: sup, body: crop })).status, 403);
});

test('crops: add, duplicate refused, limits checked, edit, remove', async () => {
  const crop = { name: `Test crop ${rand()}`, variety: 'Grand Naine', defaultGrowth: 3 };
  const r = await call('/setup/crops', { token: mgr, body: crop });
  assert.equal(r.status, 201);
  made.cropIds.push(r.body.cropId);
  assert.equal((await call('/setup/crops', { token: mgr, body: { ...crop, name: crop.name.toUpperCase() } })).status, 409);
  const bad = await call('/setup/crops', { token: mgr, body: { ...crop, variety: 'X', defaultGrowth: 7 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /between 1 and 6/);
  const edit = await call(`/setup/crops/${r.body.cropId}`, { token: mgr, method: 'PUT', body: { ...crop, defaultGrowth: 4 } });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.defaultGrowth, 4);
  assert.equal((await call(`/setup/crops/${r.body.cropId}`, { token: mgr, method: 'DELETE' })).status, 200);
  assert.equal((await call('/setup/crops/1', { token: mgr, method: 'DELETE' })).status, 409, 'crop used by batches stays');
});

test('benches: code upper-cased and unique in its zone', async () => {
  const code = `t-${rand()}`;
  const r = await call('/setup/benches', { token: mgr, body: { areaId: 1, code, capacityTrays: 5 } });
  assert.equal(r.status, 201);
  made.benchIds.push(r.body.benchId);
  assert.equal(r.body.code, code.toUpperCase());
  assert.equal((await call('/setup/benches', { token: mgr, body: { areaId: 1, code, capacityTrays: 5 } })).status, 409);
  assert.equal((await call('/setup/benches', { token: mgr, body: { areaId: 1, code: 'X1', capacityTrays: 0 } })).status, 400);
  const inZone = await call('/setup/benches?areaId=1', { token: mgr });
  assert.ok(inZone.body.every((b: any) => b.areaId === 1));
  assert.equal((await call('/setup/areas/1', { token: mgr, method: 'DELETE' })).status, 409, 'zone with benches stays');
});

test('stages, media codes, alert limits and settings are checked', async () => {
  assert.equal((await call('/setup/stages', { token: mgr, body: { code: 'TOO-LONG', phase: 'ROOTING', seqNo: 99, minDays: 1, maxDays: 2 } })).status, 400);
  const days = await call('/setup/stages', { token: mgr, body: { code: 'Z9', phase: 'ROOTING', seqNo: 99, minDays: 10, maxDays: 5 } });
  assert.equal(days.status, 400);
  assert.equal((await call('/setup/stages', { token: mgr, body: { code: 'm1', phase: 'MULTIPLICATION', seqNo: 99, minDays: 1, maxDays: 2 } })).status, 409, 'M1 exists');
  assert.equal((await call('/setup/recipes', { token: mgr, body: { code: 'mu-01', phase: 'MULTIPLICATION', shelfLifeDays: 3 } })).status, 409, 'MU-01 exists');

  const rules = await call('/setup/alert-rules', { token: mgr });
  const above = rules.body.find((r: any) => r.direction === 'ABOVE');
  const bad = await call(`/setup/alert-rules/${above.ruleId}`, { token: mgr, method: 'PUT', body: { warnValue: 10, criticalValue: 5 } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /above the warning/);

  const s = await call('/setup/settings', { token: mgr });
  assert.equal(s.status, 200);
  assert.equal((await call('/setup/settings', { token: mgr, method: 'PUT', body: { ...s.body, lastMultiplicationStage: 'ZZ' } })).status, 400);
  assert.equal((await call('/setup/settings', { token: mgr, method: 'PUT', body: { ...s.body, rootingSurvival: 1.5 } })).status, 400);
});

test('people: manager adds an operator, who can sign in until marked as left', async () => {
  const phone = `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const person = { fullName: 'Test Operator', role: 'OPERATOR', phone, homeAreaId: 3, zoneIds: [3, 4] };
  assert.equal((await call('/users', { token: sup, body: { ...person, password: 'Tissue2026' } })).status, 403);
  assert.equal((await call('/users', { token: mgr, body: { ...person, password: '1234' } })).status, 400, 'weak password');
  assert.equal((await call('/users', { token: mgr, body: { ...person, role: 'SUPERVISOR', zoneIds: [], password: 'Tissue2026' } })).status, 400, 'supervisor needs zones');
  const r = await call('/users', { token: mgr, body: { ...person, password: 'Tissue2026' } });
  assert.equal(r.status, 201);
  made.userIds.push(r.body.userId);
  assert.deepEqual(r.body.zoneIds, [4], 'home zone is not repeated as an extra zone');
  assert.equal(r.body.passwordHash, undefined);
  assert.equal((await call('/users', { token: mgr, body: { ...person, password: 'Tissue2026' } })).status, 409, 'phone already used');

  const login = await call('/auth/login', { body: { phone, password: 'Tissue2026' } });
  assert.equal(login.status, 200);
  const left = await call(`/users/${r.body.userId}`, { token: mgr, method: 'PUT', body: { ...person, status: 'LEFT' } });
  assert.equal(left.status, 200);
  assert.equal((await call('/auth/me', { token: login.body.accessToken })).status, 401, 'signed out once marked as left');
  assert.equal((await call('/auth/login', { body: { phone, password: 'Tissue2026' } })).status, 401);
});
