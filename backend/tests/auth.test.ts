// Login and access tests against the real database (uses your .env). Run: npm test
// Leaves the sample data as it was: every password changed here is put back to 1234.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { hashToken, newToken } from '../src/lib/tokens.js';
import { limits } from '../src/routes/auth.js';

const MANAGER = '9000000001';
const SUPERVISOR_A = '9000000002'; // zones 1 and 2
const ASHA = '9000000004'; // operator, home zone 3
const KIRAN = '9000000009'; // operator, home zone 1
let base = '';
let close: () => void;

before(async () => {
  // Neon puts a free database to sleep when idle; the first connection can take a few seconds to wake it.
  for (let i = 0; ; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  close = () => server.close();
});
after(async () => {
  // Put the sample password back for everyone touched here.
  const hash = await bcrypt.hash('1234', 10);
  await prisma.user.updateMany({ where: { phone: { in: [ASHA, KIRAN] } }, data: { passwordHash: hash } });
  for (const l of Object.values(limits)) (l as unknown as { hits: Map<string, unknown> }).hits.clear();
  close();
  await prisma.$disconnect();
});

async function call(path: string, opts: { method?: string; body?: unknown; token?: string; cookie?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { Cookie: `tf_refresh=${opts.cookie}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('tf_refresh='));
  const cookie = setCookie ? decodeURIComponent(setCookie.split(';')[0].slice('tf_refresh='.length)) : undefined;
  return { status: res.status, body: (await res.json()) as any, cookie, setCookie };
}

const login = (phone: string, password = '1234') => call('/auth/login', { body: { phone, password } });

test('sign in with phone and password', async () => {
  const r = await login(MANAGER);
  assert.equal(r.status, 200);
  assert.ok(r.body.accessToken);
  assert.equal(r.body.user.role, 'MANAGER');
  assert.equal(r.body.user.passwordHash, undefined, 'password hash must never be sent');
  assert.ok(r.cookie, 'refresh cookie is set');
  assert.match(r.setCookie!, /HttpOnly/i);
  assert.match(r.setCookie!, /Path=\/api\/v1\/auth/);
});

test('wrong password or unknown phone gets the same reply', async () => {
  const a = await login(MANAGER, 'wrong');
  const b = await login('9999999999', 'wrong');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
  limits.loginPhone.reset(MANAGER);
});

test('protected pages need a valid token', async () => {
  assert.equal((await call('/auth/me')).status, 401);
  assert.equal((await call('/auth/me', { token: 'abc.def.ghi' })).status, 401);
  const { body } = await login(ASHA);
  const me = await call('/auth/me', { token: body.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.fullName, 'Asha');
});

test('people list: manager all, supervisor own zones, operator none', async () => {
  const m = await login(MANAGER);
  const s = await login(SUPERVISOR_A);
  const o = await login(ASHA);
  const all = await call('/users', { token: m.body.accessToken });
  assert.equal(all.status, 200);
  const total = await prisma.user.count();
  assert.equal(all.body.users.length, total);

  const mine = await call('/users', { token: s.body.accessToken });
  assert.equal(mine.status, 200);
  const phones = mine.body.users.map((u: any) => u.phone);
  assert.ok(phones.includes(KIRAN), 'zone 1 operator is visible');
  assert.ok(!phones.includes(ASHA), 'zone 3 operator is hidden');

  assert.equal((await call('/users', { token: o.body.accessToken })).status, 403);
});

test('refresh gives a new token and the old one stops working', async () => {
  const first = await login(ASHA);
  const r1 = await call('/auth/refresh', { method: 'POST', cookie: first.cookie });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.accessToken);
  assert.ok(r1.cookie && r1.cookie !== first.cookie);
  // Old token used again right away (two tabs): refused, but nothing else is affected.
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: first.cookie })).status, 401);
  assert.equal((await call('/auth/me', { token: r1.body.accessToken })).status, 200);
});

test('an old refresh token used later signs the user out everywhere', async () => {
  const first = await login(ASHA);
  const r1 = await call('/auth/refresh', { method: 'POST', cookie: first.cookie });
  // Pretend the old token was replaced a minute ago.
  await prisma.authSession.update({ where: { tokenHash: hashToken(first.cookie!) }, data: { revokedAt: new Date(Date.now() - 60_000) } });
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: first.cookie })).status, 401);
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: r1.cookie })).status, 401, 'new token also ended');
  assert.equal((await call('/auth/me', { token: r1.body.accessToken })).status, 401, 'access token also ended');
});

test('sign out, and sign out of all devices', async () => {
  const phone = await login(ASHA);
  const laptop = await login(ASHA);
  assert.equal((await call('/auth/logout', { method: 'POST', cookie: phone.cookie })).status, 200);
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: phone.cookie })).status, 401);
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: laptop.cookie })).status, 200, 'other device still signed in');

  const again = await login(ASHA);
  const other = await login(ASHA);
  assert.equal((await call('/auth/logout-all', { method: 'POST', token: again.body.accessToken })).status, 200);
  assert.equal((await call('/auth/me', { token: other.body.accessToken })).status, 401);
  assert.equal((await call('/auth/refresh', { method: 'POST', cookie: other.cookie })).status, 401);
});

test('too many wrong passwords are blocked for a while', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login(KIRAN, 'wrong')).status, 401);
  const blocked = await login(KIRAN, '1234');
  assert.equal(blocked.status, 429, 'even the right password waits');
  limits.loginPhone.reset(KIRAN);
  assert.equal((await login(KIRAN)).status, 200);
});

test('change password: rules, other devices signed out, new password works', async () => {
  const here = await login(ASHA);
  const elsewhere = await login(ASHA);
  const token = here.body.accessToken;
  assert.equal((await call('/auth/change-password', { token, body: { currentPassword: 'wrong', newPassword: 'Tissue2026' } })).status, 400);
  const weak = await call('/auth/change-password', { token, body: { currentPassword: '1234', newPassword: 'short' } });
  assert.equal(weak.status, 400);
  assert.match(weak.body.error, /8 characters/);

  const ok = await call('/auth/change-password', { token, body: { currentPassword: '1234', newPassword: 'Tissue2026' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.accessToken && ok.cookie, 'this device keeps a fresh session');
  assert.equal((await call('/auth/me', { token: ok.body.accessToken })).status, 200);
  assert.equal((await call('/auth/me', { token: elsewhere.body.accessToken })).status, 401);
  assert.equal((await login(ASHA)).status, 401, 'old password no longer works');
  assert.equal((await login(ASHA, 'Tissue2026')).status, 200);
  limits.loginPhone.reset(ASHA);
});

test('forgot password gives the same reply for any input', async () => {
  const a = await call('/auth/forgot-password', { body: { login: MANAGER } });
  const b = await call('/auth/forgot-password', { body: { login: 'nobody@example.com' } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.message, b.body.message);
});

test('reset link sets a new password once and signs out everywhere', async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { phone: KIRAN } });
  const session = await login(KIRAN);
  // Same record the email step creates; the link itself is printed in the server console.
  const token = newToken();
  await prisma.passwordReset.create({ data: { userId: user.userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });

  const weak = await call('/auth/reset-password', { body: { token, newPassword: 'abc' } });
  assert.equal(weak.status, 400);
  const ok = await call('/auth/reset-password', { body: { token, newPassword: 'Banana2026' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/auth/reset-password', { body: { token, newPassword: 'Banana2027' } })).status, 400, 'link works once');
  assert.equal((await call('/auth/me', { token: session.body.accessToken })).status, 401);
  assert.equal((await login(KIRAN, 'Banana2026')).status, 200);
  assert.equal((await call('/auth/reset-password', { body: { token: newToken(), newPassword: 'Banana2026' } })).status, 400);
});
