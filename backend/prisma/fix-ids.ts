// Moves every id counter past the highest id in its table. Safe to run any time; changes no data.
// Run: npm run db:fix-ids
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { fixIdCounters } from './idCounters';

const prisma = new PrismaClient();
fixIdCounters(prisma)
  .then(() => console.log('Id counters fixed.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
