// Small HS256 JSON Web Token sign/verify using Node's built-in crypto (no extra package).
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AccessClaims {
  sub: number; // userId
  role: 'MANAGER' | 'SUPERVISOR' | 'OPERATOR';
  tv: number; // tokenVersion at sign-in
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function sign(data: string, secret: string) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signJwt(claims: Omit<AccessClaims, 'iat' | 'exp'>, secret: string, ttlSec: number, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = b64url(JSON.stringify({ ...claims, iat, exp: iat + ttlSec }));
  const data = `${HEADER}.${body}`;
  return `${data}.${sign(data, secret)}`;
}

/** Returns the claims, or null if the token is malformed, tampered with or expired. */
export function verifyJwt(token: string, secret: string, now = Date.now()): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  if (h !== HEADER) return null;
  const expected = Buffer.from(sign(`${h}.${b}`, secret));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.sub !== 'number' || typeof claims.exp !== 'number' || typeof claims.tv !== 'number') return null;
  if (claims.exp * 1000 <= now) return null;
  return claims;
}
