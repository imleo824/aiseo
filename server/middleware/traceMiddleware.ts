import { Request, Response, NextFunction } from 'express';

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
  const traceId = (typeof incomingTraceId === 'string' && incomingTraceId.trim()) 
    ? incomingTraceId 
    : `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  req.traceId = traceId;
  req.startTime = Date.now();

  res.setHeader('X-Trace-Id', traceId);

  next();
}
