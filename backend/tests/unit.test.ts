// Checks the small building blocks. Needs no database: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCookie } from '../src/lib/cookies.js';
import { signJwt, verifyJwt } from '../src/lib/jwt.js';
import { passwordProblem } from '../src/lib/passwordPolicy.js';
import { RateLimiter } from '../src/lib/rateLimit.js';
import { hashToken, newToken } from '../src/lib/tokens.js';

const SECRET = 'x'.repeat(40);

test('a signed token verifies and keeps its claims', () => {
  const t = signJwt({ sub: 4, role: 'OPERATOR', tv: 2 }, SECRET, 60);
  const c = verifyJwt(t, SECRET);
  assert.equal(c?.sub, 4);
  assert.equal(c?.role, 'OPERATOR');
  assert.equal(c?.tv, 2);
});

test('a token signed with another secret, changed, or expired is refused', () => {
  const t = signJwt({ sub: 1, role: 'MANAGER', tv: 0 }, SECRET, 60);
  assert.equal(verifyJwt(t, 'y'.repeat(40)), null);
  const [h, , s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 1, role: 'MANAGER', tv: 0, iat: 0, exp: 9e9 })).toString('base64url');
  assert.equal(verifyJwt(`${h}.${forged}.${s}`, SECRET), null);
  assert.equal(verifyJwt(t, SECRET, Date.now() + 61_000), null);
  assert.equal(verifyJwt('not.a.token', SECRET), null);
  assert.equal(verifyJwt('', SECRET), null);
});

test('password rules', () => {
  assert.match(passwordProblem('1234')!, /8 characters/);
  assert.match(passwordProblem('abcdefgh')!, /letter and one number/);
  assert.match(passwordProblem('12345678')!, /letter and one number/);
  assert.match(passwordProblem('a9000000004', '9000000004')!, /phone/);
  assert.match(passwordProblem('a'.repeat(70) + '12345')!, /too long/);
  assert.equal(passwordProblem('Tissue2026', '9000000004'), null);
});

test('rate limiter blocks after the limit and frees up after the window', () => {
  const r = new RateLimiter(3, 1000);
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) {
    assert.equal(r.retryAfter('k', t0), 0);
    r.hit('k', t0);
  }
  assert.equal(r.retryAfter('k', t0), 1);
  assert.equal(r.retryAfter('other', t0), 0);
  assert.equal(r.retryAfter('k', t0 + 1001), 0);
  r.hit('k', t0 + 1001);
  r.reset('k');
  assert.equal(r.retryAfter('k', t0 + 1001), 0);
});

test('cookies are read by name', () => {
  assert.equal(readCookie('a=1; tf_refresh=abc%2D1; b=2', 'tf_refresh'), 'abc-1');
  assert.equal(readCookie('a=1', 'tf_refresh'), undefined);
  assert.equal(readCookie(undefined, 'tf_refresh'), undefined);
});

test('tokens are random and their hash is stable', () => {
  const a = newToken();
  assert.notEqual(a, newToken());
  assert.ok(a.length >= 40);
  assert.equal(hashToken(a), hashToken(a));
  assert.equal(hashToken(a).length, 64);
});
