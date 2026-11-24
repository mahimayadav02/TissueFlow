// The Express app: security headers, allowed website addresses, JSON bodies, routes and error replies.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { health } from './routes/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => {
    res.json({ name: 'TissueFlow API', version: 'v1', health: '/api/v1/health' });
  });
  app.use('/api/v1/health', health);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
