// People. Manager sees and edits everyone; a supervisor sees only people in their zones; operators have no access.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { idParam } from '../lib/params.js';
import { passwordProblem } from '../lib/passwordPolicy.js';
import { hashPassword } from '../lib/passwords.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth, requireRole, visibleAreaIds } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { publicUser, revokeAll, userSelect } from '../services/authService.js';

export const users = Router();
users.use(requireAuth);

users.get('/', requireRole('MANAGER', 'SUPERVISOR'), async (req, res) => {
  const areas = visibleAreaIds(req);
  const where: Prisma.UserWhereInput = areas
    ? { OR: [{ userId: req.user!.userId }, { role: 'OPERATOR', OR: [{ homeAreaId: { in: areas } }, { zones: { some: { areaId: { in: areas } } } }] }] }
    : {};
  const list = await prisma.user.findMany({ where, select: userSelect, orderBy: { userId: 'asc' } });
  res.json({ users: list.map(publicUser) });
});

const userBody = z.object({
  fullName: z.string().trim().min(1, 'Name is required.').max(100),
  role: z.enum(['MANAGER', 'SUPERVISOR', 'OPERATOR']),
  phone: z.string().trim().regex(/^\d{10}$/, 'Phone must be 10 digits.'),
  // An empty box means no email.
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().toLowerCase().email('Enter a valid email or leave it empty.').nullable().optional()),
  homeAreaId: z.number().int().positive().nullable().default(null),
  zoneIds: z.array(z.number().int().positive()).max(20).default([]),
  status: z.enum(['ACTIVE', 'LEFT']).default('ACTIVE'),
  /** Needed for a new user; for an existing user, sets a new password. */
  password: z.string().max(200).optional(),
});
type UserBody = z.infer<typeof userBody>;

/** Same rules as the website: supervisors need zones, operators a home zone; extra zones never repeat the home zone. */
async function clean(u: UserBody, exceptId?: number) {
  if (u.role === 'SUPERVISOR' && u.zoneIds.length === 0) throw new ApiError(400, 'Choose at least one zone for the supervisor.');
  if (u.role === 'OPERATOR' && !u.homeAreaId) throw new ApiError(400, 'Choose the zone where the operator works.');
  const homeAreaId = u.role === 'MANAGER' ? null : u.homeAreaId;
  const zoneIds = u.role === 'MANAGER' ? [] : [...new Set(u.zoneIds.filter((z) => z !== homeAreaId))];
  const ids = [...zoneIds, ...(homeAreaId ? [homeAreaId] : [])];
  if (ids.length && (await prisma.area.count({ where: { areaId: { in: ids } } })) !== new Set(ids).size) throw new ApiError(400, 'One of the zones does not exist.');
  const dup = await prisma.user.findFirst({ where: { phone: u.phone, NOT: exceptId ? { userId: exceptId } : undefined } });
  if (dup) throw new ApiError(409, 'This phone number is already used by another user.');
  if (u.email) {
    const dupMail = await prisma.user.findFirst({ where: { email: { equals: u.email, mode: 'insensitive' }, NOT: exceptId ? { userId: exceptId } : undefined } });
    if (dupMail) throw new ApiError(409, 'This email is already used by another user.');
  }
  if (u.password !== undefined) {
    const problem = passwordProblem(u.password, u.phone);
    if (problem) throw new ApiError(400, problem);
  }
  return { fullName: u.fullName, role: u.role, phone: u.phone, email: u.email ?? null, homeAreaId, status: u.status, zoneIds };
}

users.post('/', requireRole('MANAGER'), async (req, res) => {
  const body = parseBody(userBody, req.body);
  if (!body.password) throw new ApiError(400, 'Set a password for the new user.');
  const { zoneIds, ...data } = await clean(body);
  const passwordHash = await hashPassword(body.password);
  const saved = await prisma.user.create({
    data: { ...data, passwordHash, zones: { create: zoneIds.map((areaId) => ({ areaId })) } },
    select: userSelect,
  });
  await audit(req.user!.userId, 'Saved user', `${saved.fullName} (${saved.role}), new`);
  res.status(201).json(publicUser(saved));
});

users.put('/:id', requireRole('MANAGER'), async (req, res) => {
  const userId = idParam(req);
  const body = parseBody(userBody, req.body);
  const old = await prisma.user.findUnique({ where: { userId }, select: { role: true, status: true } });
  if (!old) throw new ApiError(404, 'User not found.');
  if (userId === req.user!.userId && (body.role !== 'MANAGER' || body.status !== 'ACTIVE')) throw new ApiError(400, 'You cannot remove your own manager access.');
  const { zoneIds, ...data } = await clean(body, userId);
  const passwordHash = body.password ? await hashPassword(body.password) : undefined;
  const saved = await prisma.$transaction(async (tx) => {
    await tx.userZone.deleteMany({ where: { userId } });
    await tx.user.update({ where: { userId }, data: { ...data, ...(passwordHash ? { passwordHash } : {}), zones: { create: zoneIds.map((areaId) => ({ areaId })) } } });
    // Role changed, account closed or password set by the manager: the person must sign in again.
    if (old.role !== data.role || data.status !== 'ACTIVE' || passwordHash) return revokeAll(userId, tx);
    return tx.user.findUniqueOrThrow({ where: { userId }, select: userSelect });
  });
  await audit(req.user!.userId, 'Saved user', `${saved.fullName} (${saved.role}, ${saved.status})${passwordHash ? ', password set' : ''}`);
  res.json(publicUser(saved));
});
