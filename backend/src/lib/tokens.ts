// Random tokens for device sessions and reset links. Only the SHA-256 hash is stored in the database.
import { createHash, randomBytes } from 'node:crypto';

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
