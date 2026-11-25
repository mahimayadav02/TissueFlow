// Sign-in sessions: create, rotate, revoke. Refresh tokens are random strings kept in an httpOnly cookie;
// the database stores only their hash.
import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { signJwt } from '../lib/jwt.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { ApiError } from '../middleware/errors.js';

/** A rotated token shown again within this time is treated as two tabs refreshing at once, not theft. */
const REUSE_GRACE_MS = 10_000;

export const userSelect = {
  userId: true, fullName: true, role: true, phone: true, email: true, homeAreaId: true, status: true, tokenVersion: true,
  zones: { select: { areaId: true } },
} satisfies Prisma.UserSelect;
type DbUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** The user as the website sees it (same fields as the frontend User type). */
export function publicUser(u: DbUser) {
  return { userId: u.userId, fullName: u.fullName, role: u.role, phone: u.phone, email: u.email, homeAreaId: u.homeAreaId, zoneIds: u.zones.map((z) => z.areaId), status: u.status };
}

export const accessToken = (u: { userId: number; role: DbUser['role']; tokenVersion: number }) =>
  signJwt({ sub: u.userId, role: u.role, tv: u.tokenVersion }, env.JWT_SECRET, env.accessTtlSec);

export async function createSession(userId: number, userAgent: string | undefined, db: Prisma.TransactionClient = prisma) {
  const token = newToken();
  await db.authSession.create({
    data: { userId, tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 300), expiresAt: new Date(Date.now() + env.refreshTtlDays * 86_400_000) },
  });
  return token;
}

/** Signs the user out everywhere: ends every session and makes old access tokens invalid. */
export async function revokeAll(userId: number, db: Prisma.TransactionClient = prisma) {
  await db.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return db.user.update({ where: { userId }, data: { tokenVersion: { increment: 1 } }, select: userSelect });
}

/** Swaps a refresh token for a new one. Returns the new token, the user and a fresh access token. */
export async function rotate(token: string, userAgent: string | undefined) {
  const s = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!s) throw new ApiError(401, 'Please sign in.');

  if (s.revokedAt) {
    if (Date.now() - s.revokedAt.getTime() > REUSE_GRACE_MS) {
      // An old token came back: someone may have copied it. End every session for this user.
      await revokeAll(s.userId);
      await audit(s.userId, 'auth.refresh_reuse', 'Old sign-in token reused; all devices signed out');
    }
    throw new ApiError(401, 'Please sign in again.');
  }
  if (s.expiresAt <= new Date()) throw new ApiError(401, 'Your session has ended. Please sign in again.');

  return prisma.$transaction(async (tx) => {
    // Only one request can win the swap; a second one at the same moment gets 401.
    const done = await tx.authSession.updateMany({ where: { sessionId: s.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (done.count !== 1) throw new ApiError(401, 'Please sign in again.');
    const user = await tx.user.findUnique({ where: { userId: s.userId }, select: userSelect });
    if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'Please sign in again.');
    const next = await createSession(user.userId, userAgent, tx);
    return { refreshToken: next, user, accessToken: accessToken(user) };
  });
}

export async function revokeByToken(token: string) {
  await prisma.authSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
