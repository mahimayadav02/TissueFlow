// Sign in, refresh, sign out, change password, forgot / reset password.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { audit } from '../lib/audit.js';
import { readCookie } from '../lib/cookies.js';
import { sendMail } from '../lib/mailer.js';
import { passwordProblem } from '../lib/passwordPolicy.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { RateLimiter } from '../lib/rateLimit.js';
import { hashToken, newToken } from '../lib/tokens.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import { accessToken, createSession, publicUser, revokeAll, revokeByToken, rotate, userSelect } from '../services/authService.js';

export const auth = Router();

const COOKIE = 'tf_refresh';
const COOKIE_PATH = '/api/v1/auth';
const MIN15 = 15 * 60_000;

// Wrong-attempt limits.
export const limits = {
  loginPhone: new RateLimiter(5, MIN15), // 5 wrong passwords per phone in 15 min
  loginIp: new RateLimiter(20, MIN15), // 20 wrong passwords per IP in 15 min
  forgot: new RateLimiter(5, MIN15), // 5 reset requests per IP in 15 min
  changePw: new RateLimiter(5, MIN15), // 5 wrong current passwords per user in 15 min
};

function tooMany(res: Response, seconds: number): never {
  res.setHeader('Retry-After', String(seconds));
  throw new ApiError(429, `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`);
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    // Website and API are on different addresses when hosted, so the cookie must be allowed cross-site there.
    sameSite: env.isProd ? 'none' : 'lax',
    path: COOKIE_PATH,
    maxAge: env.refreshTtlDays * 86_400_000,
  });
}
function clearRefreshCookie(res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: env.isProd, sameSite: env.isProd ? 'none' : 'lax', path: COOKIE_PATH });
}

/** Routes that use the cookie only accept calls from our own website (or tools that send no Origin). */
function checkOrigin(req: Request) {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) throw new ApiError(403, 'Request from an unknown website.');
}

const phoneSchema = z.string().trim().transform((s) => s.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\+?\d{10,13}$/, 'Enter a valid phone number'));

auth.post('/login', async (req, res) => {
  checkOrigin(req);
  const { phone, password } = parseBody(z.object({ phone: phoneSchema, password: z.string().min(1, 'Enter your password').max(200) }), req.body);
  const ip = req.ip ?? 'unknown';
  const wait = Math.max(limits.loginPhone.retryAfter(phone), limits.loginIp.retryAfter(ip));
  if (wait) tooMany(res, wait);

  const user = await prisma.user.findUnique({ where: { phone }, select: { ...userSelect, passwordHash: true } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || user.status !== 'ACTIVE') {
    limits.loginPhone.hit(phone);
    limits.loginIp.hit(ip);
    if (user) await audit(user.userId, 'auth.login_failed', `ip ${ip}`);
    throw new ApiError(401, user && ok ? 'This account is no longer active.' : 'Phone number or password is wrong.');
  }
  limits.loginPhone.reset(phone);

  const refresh = await createSession(user.userId, req.get('user-agent'));
  setRefreshCookie(res, refresh);
  await audit(user.userId, 'auth.login', `ip ${ip}`);
  res.json({ accessToken: accessToken(user), expiresIn: env.accessTtlSec, user: publicUser(user) });
});

auth.post('/refresh', async (req, res) => {
  checkOrigin(req);
  const token = readCookie(req.get('cookie'), COOKIE);
  if (!token) throw new ApiError(401, 'Please sign in.');
  try {
    const r = await rotate(token, req.get('user-agent'));
    setRefreshCookie(res, r.refreshToken);
    res.json({ accessToken: r.accessToken, expiresIn: env.accessTtlSec, user: publicUser(r.user) });
  } catch (e) {
    clearRefreshCookie(res);
    throw e;
  }
});

auth.post('/logout', async (req, res) => {
  checkOrigin(req);
  const token = readCookie(req.get('cookie'), COOKIE);
  if (token) await revokeByToken(token);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

auth.post('/logout-all', requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  await revokeAll(userId);
  clearRefreshCookie(res);
  await audit(userId, 'auth.logout_all', 'Signed out of all devices');
  res.json({ ok: true });
});

auth.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { userId: req.user!.userId }, select: userSelect });
  res.json({ user: publicUser(user) });
});

auth.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parseBody(
    z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword: z.string().max(200) }),
    req.body,
  );
  const userId = req.user!.userId;
  const key = String(userId);
  const wait = limits.changePw.retryAfter(key);
  if (wait) tooMany(res, wait);

  const user = await prisma.user.findUniqueOrThrow({ where: { userId }, select: { phone: true, passwordHash: true } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    limits.changePw.hit(key);
    throw new ApiError(400, 'Current password is wrong.');
  }
  limits.changePw.reset(key);
  const problem = passwordProblem(newPassword, user.phone);
  if (problem) throw new ApiError(400, problem);
  if (newPassword === currentPassword) throw new ApiError(400, 'New password must be different from the current one.');

  const passwordHash = await hashPassword(newPassword);
  // Every other device is signed out; this device gets a new session.
  const { updated, refresh } = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { userId }, data: { passwordHash } });
    const updated = await revokeAll(userId, tx);
    const refresh = await createSession(userId, req.get('user-agent'), tx);
    return { updated, refresh };
  });
  setRefreshCookie(res, refresh);
  await audit(userId, 'auth.password_changed', 'Other devices signed out');
  res.json({ accessToken: accessToken(updated), expiresIn: env.accessTtlSec, user: publicUser(updated) });
});

const GENERIC_FORGOT = 'If this account has an email address, a reset link has been sent to it. The link works for 30 minutes.';

auth.post('/forgot-password', async (req, res) => {
  checkOrigin(req);
  const { login } = parseBody(z.object({ login: z.string().trim().min(3, 'Enter your phone number or email').max(200) }), req.body);
  const ip = req.ip ?? 'unknown';
  const wait = limits.forgot.retryAfter(ip);
  if (wait) tooMany(res, wait);
  limits.forgot.hit(ip);

  const isEmail = login.includes('@');
  const user = await prisma.user.findFirst({
    where: isEmail ? { email: { equals: login, mode: 'insensitive' } } : { phone: login.replace(/[\s-]/g, '') },
    select: { userId: true, fullName: true, email: true, status: true },
  });
  // Same reply whether or not the account exists, so the form can't be used to find accounts.
  if (user && user.status === 'ACTIVE' && user.email) {
    const token = newToken();
    await prisma.$transaction([
      // Older unused links stop working when a new one is asked for.
      prisma.passwordReset.updateMany({ where: { userId: user.userId, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.passwordReset.create({ data: { userId: user.userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + env.resetTtlMin * 60_000) } }),
    ]);
    const link = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
    await sendMail(
      user.email,
      'Reset your TissueFlow password',
      `Hello ${user.fullName},\n\nOpen this link to set a new password. It works for ${env.resetTtlMin} minutes and only once:\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    );
    await audit(user.userId, 'auth.reset_requested', `ip ${ip}`);
  }
  res.json({ ok: true, message: GENERIC_FORGOT });
});

auth.post('/reset-password', async (req, res) => {
  checkOrigin(req);
  const { token, newPassword } = parseBody(z.object({ token: z.string().min(20).max(200), newPassword: z.string().max(200) }), req.body);
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { phone: true, status: true } } } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date() || reset.user.status !== 'ACTIVE') {
    throw new ApiError(400, 'This reset link is not valid or has expired. Ask for a new one.');
  }
  const problem = passwordProblem(newPassword, reset.user.phone);
  if (problem) throw new ApiError(400, problem);

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    const used = await tx.passwordReset.updateMany({ where: { resetId: reset.resetId, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new ApiError(400, 'This reset link has already been used.');
    await tx.user.update({ where: { userId: reset.userId }, data: { passwordHash } });
    await revokeAll(reset.userId, tx);
  });
  limits.loginPhone.reset(reset.user.phone);
  await audit(reset.userId, 'auth.password_reset', 'Password set from email link; all devices signed out');
  res.json({ ok: true, message: 'Password changed. Please sign in with your new password.' });
});
