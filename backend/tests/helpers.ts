// Shared by the API tests: start the app on a free port, call it, sign in.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

export const PHONES = {
  manager: '9000000001',
  supervisorA: '9000000002', // zones 1 and 2
  supervisorB: '9000000003', // zones 3, 4 and 6
  asha: '9000000004', // operator, home zone 3
  kiran: '9000000009', // operator, home zone 1
};

let server: Server | undefined;
let base = '';

/** Wakes the database (Neon sleeps when idle) and starts the app. */
export async function start() {
  for (let i = 0; ; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  server = createApp().listen(0);
  await new Promise((r) => server!.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
}

export async function stop() {
  server?.close();
  await prisma.$disconnect();
}

export async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const tokens = new Map<string, string>();
/** Access token for a sample account (signed in once per test file). */
export async function tokenFor(phone: string, password = '1234'): Promise<string> {
  const have = tokens.get(phone);
  if (have) return have;
  const r = await call('/auth/login', { body: { phone, password } });
  if (r.status !== 200) throw new Error(`Sign-in failed for ${phone}: ${r.status} ${JSON.stringify(r.body)}`);
  tokens.set(phone, r.body.accessToken);
  return r.body.accessToken;
}

export const rand = () => Math.random().toString(36).slice(2, 7).toUpperCase();
