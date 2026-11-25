// People list. Manager sees everyone; a supervisor sees only people in their zones; operators have no access.
import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireRole, visibleAreaIds } from '../middleware/auth.js';
import { publicUser, userSelect } from '../services/authService.js';

export const users = Router();

users.get('/', requireAuth, requireRole('MANAGER', 'SUPERVISOR'), async (req, res) => {
  const areas = visibleAreaIds(req);
  const where: Prisma.UserWhereInput = areas
    ? { OR: [{ userId: req.user!.userId }, { role: 'OPERATOR', OR: [{ homeAreaId: { in: areas } }, { zones: { some: { areaId: { in: areas } } } }] }] }
    : {};
  const list = await prisma.user.findMany({ where, select: userSelect, orderBy: { userId: 'asc' } });
  res.json({ users: list.map(publicUser) });
});
