import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      traceId?: string;
      startTime?: number;
    }
  }
}

export function traceMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingTraceId = req.headers['x-trace-id'] || req.headers['x-correlation-id'];
  const candidate = typeof incomingTraceId === 'string' ? incomingTraceId.trim() : '';
  const traceId = /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : `trace-${randomUUID()}`;

  req.traceId = traceId;
  req.startTime = Date.now();

  res.setHeader('X-Trace-Id', traceId);

  next();
}
