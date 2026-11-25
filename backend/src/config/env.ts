// Reads the settings from the .env file (or the hosting service) and stops at start-up if one is missing.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/** An empty value in .env (KEY="") counts as not set. */
const optional = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional());

const schema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be the Neon connection string (pooled)'),
  DIRECT_URL: z.string().url('DIRECT_URL must be the Neon connection string (not pooled)'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Secret used to sign sign-in tokens. At least 32 characters; required on the live server. */
  JWT_SECRET: optional(z.string().min(32, 'JWT_SECRET must be at least 32 characters')),
  /** Address of the website, used in the password reset email link. */
  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Optional: Resend API key for sending emails. Without it the reset link is printed in the server console. */
  RESEND_API_KEY: optional(z.string()),
  MAIL_FROM: z.string().default('TissueFlow <onboarding@resend.dev>'),
  /** How many proxies sit in front of the server (Render: 1; Vercel passing calls on to Render: 2). Used to find the caller's IP. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Settings are missing or wrong. Check your .env file (see .env.example):');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

let jwtSecret = parsed.data.JWT_SECRET;
if (!jwtSecret) {
  if (parsed.data.NODE_ENV === 'production') {
    console.error('JWT_SECRET is required on the live server (at least 32 characters).');
    process.exit(1);
  }
  jwtSecret = randomBytes(32).toString('hex');
  console.warn('JWT_SECRET is not set: using a temporary one. Everyone is signed out when the server restarts.');
}

export const env = {
  ...parsed.data,
  JWT_SECRET: jwtSecret,
  isProd: parsed.data.NODE_ENV === 'production',
  /** Sign-in token lifetime (short) and device session lifetime (long). */
  accessTtlSec: 15 * 60,
  refreshTtlDays: 30,
  resetTtlMin: 30,
  /** Website addresses allowed to call the API. */
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean),
};
