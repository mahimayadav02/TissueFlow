// Checks a request body against a zod schema and turns problems into a 400 reply.
import type { z } from 'zod';
import { ApiError } from '../middleware/errors.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ApiError(400, i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message);
  }
  return r.data;
}
