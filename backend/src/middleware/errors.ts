// Turns errors into clear JSON replies. Rule errors thrown with ApiError keep their message;
// anything unexpected is logged and the user gets a general message.
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
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
};
