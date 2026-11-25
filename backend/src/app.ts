// The Express app: security headers, allowed website addresses, JSON bodies, routes and error replies.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { auth } from './routes/auth.js';
import { daily } from './routes/daily.js';
import { health } from './routes/health.js';
import { production } from './routes/production.js';
import { results } from './routes/results.js';
import { setup } from './routes/setup.js';
import { users } from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // The server sits behind proxies (Render's, and Vercel's when the website passes calls on): use their
  // address header to find the caller's IP, which the wrong-password limits count by.
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // One line per request with how long it took (shown in Render's Logs). Health checks are left out.
  if (env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      if (req.path.endsWith('/health')) return next();
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms${ms > 2000 ? '  SLOW' : ''}`);
      });
      next();
    });
  }
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (_req, res) => {
    res.json({ name: 'TissueFlow API', version: 'v1', health: '/api/v1/health' });
  });
  app.use('/api/v1/health', health);
  app.use('/api/v1/auth', auth);
  app.use('/api/v1/users', users);
  app.use('/api/v1/setup', setup);
  app.use('/api/v1/daily', daily);
  app.use('/api/v1', results);
  app.use('/api/v1', production);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
