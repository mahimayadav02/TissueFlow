// One shared database client for the whole server.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  // A change made of several steps (e.g. a sub-culture) runs as one transaction. The database may be far away
  // or just waking up, so allow more than the default 5 seconds.
  transactionOptions: { maxWait: 15_000, timeout: 30_000 },
});
