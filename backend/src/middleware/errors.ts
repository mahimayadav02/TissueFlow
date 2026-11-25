// Turns errors into clear JSON replies. Rule errors thrown with ApiError keep their message;
// anything unexpected is logged and the user gets a general message.
import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Database rules: a duplicate, a record still in use, or a record that is gone.
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A record with these details already exists.' });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({ error: 'This is still used by other records, so it cannot be removed.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
};
