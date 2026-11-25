import type { Request } from 'express';
import { ApiError } from '../middleware/errors.js';

/** A whole-number id from the address, e.g. /batches/12. */
export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${name} must be a positive whole number.`);
  return n;
}
