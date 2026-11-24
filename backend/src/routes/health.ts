// GET /api/v1/health — shows the server is running and can reach the database,
// with a count of the main records so it is easy to see the sample data is loaded.
import { Router } from 'express';
import { prisma } from '../db/prisma.js';

export const health = Router();

health.get('/', async (_req, res) => {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    const [users, zones, batches, trays, entries] = await Promise.all([
      prisma.user.count(),
      prisma.area.count(),
      prisma.batch.count(),
      prisma.tray.count({ where: { status: 'ACTIVE' } }),
      prisma.productionEntry.count(),
    ]);
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      database: { connected: true, latencyMs },
      records: { users, zones, batches, activeTrays: trays, workEntries: entries },
    });
  } catch (e) {
    console.error(e);
    res.status(503).json({ status: 'error', time: new Date().toISOString(), database: { connected: false } });
  }
});
