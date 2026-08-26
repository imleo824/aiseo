import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodic garbage collection sweep every 2 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 120000).unref();

/**
 * Enterprise Rate Limiter Middleware
 * @param windowMs Window duration in milliseconds (default 60s)
 * @param maxMax Maximum requests permitted per window
 */
export function createRateLimiter(windowMs: number = 60000, maxMax: number = 300) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip uses the socket address unless the server has explicitly enabled a
    // trusted proxy hop. This keeps the limiter correct both locally and behind
    // Railway without accepting arbitrary X-Forwarded-For headers by default.
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const tenantId = (req as any).tenantId || 'anonymous';
    const key = `${tenantId}:${ip}:${req.path.startsWith('/api/opportunities') ? 'ai' : 'general'}`;

    const now = Date.now();
    
    const existing = store.get(key);
    if (!existing || now > existing.resetTime) {
      store.set(key, {
        count: 1,
        resetTime: now + windowMs
      });
    } else {
      existing.count++;
    }
    const entry = store.get(key)!;

    // Standard RateLimit Headers
    res.setHeader('X-RateLimit-Limit', maxMax);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxMax - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > maxMax) {
      const retryAfterSeconds = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: '请求过于频繁，触发系统防护阈值，请稍后再试。',
          retryAfterSeconds
        }
      });
    }

    next();
  };
}
