// Reads the settings from the .env file (or the hosting service) and stops at start-up if one is missing.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be the Neon connection string (pooled)'),
  DIRECT_URL: z.string().url('DIRECT_URL must be the Neon connection string (not pooled)'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Settings are missing or wrong. Check your .env file (see .env.example):');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** Website addresses allowed to call the API. */
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
};
