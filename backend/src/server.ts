// Starts the API server, and closes the database connection cleanly when it stops.
import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './db/prisma.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`TissueFlow API running at http://localhost:${env.PORT}  (health: /api/v1/health)`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down …`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
