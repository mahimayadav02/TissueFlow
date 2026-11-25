// Checks the sign-in token on every protected request, and the user's role and zones.
import type { Request, RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { verifyJwt } from '../lib/jwt.js';
import { ApiError } from './errors.js';

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? verifyJwt(token, env.JWT_SECRET) : null;
  if (!claims) throw new ApiError(401, 'Please sign in.');

  const user = await prisma.user.findUnique({
    where: { userId: claims.sub },
    select: { userId: true, fullName: true, role: true, homeAreaId: true, status: true, tokenVersion: true, zones: { select: { areaId: true } } },
  });
  // Signed out of all devices, password changed, or account closed: the old token stops working.
  if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== claims.tv) throw new ApiError(401, 'Please sign in again.');

  req.user = { userId: user.userId, fullName: user.fullName, role: user.role, homeAreaId: user.homeAreaId, zoneIds: user.zones.map((z) => z.areaId) };
  next();
};

/** Use after requireAuth. Only the listed roles may continue. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw new ApiError(403, 'You do not have access to this.');
    next();
  };

/** Zones the user may see: null means all zones (manager). */
export function visibleAreaIds(req: Request): number[] | null {
  const u = req.user;
  if (!u) return [];
  if (u.role === 'MANAGER') return null;
  if (u.role === 'SUPERVISOR') return u.zoneIds;
  return [...new Set([...(u.homeAreaId ? [u.homeAreaId] : []), ...u.zoneIds])];
}

/** Throws 403 unless the user may see this zone. */
export function assertAreaAccess(req: Request, areaId: number): void {
  const ids = visibleAreaIds(req);
  if (ids && !ids.includes(areaId)) throw new ApiError(403, 'This zone is not one of yours.');
}
