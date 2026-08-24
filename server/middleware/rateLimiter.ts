import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Periodic garbage collection sweep every 2 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const key of Object.keys(store)) {
    if (store[key] && now > store[key].resetTime) {
      delete store[key];
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
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
    const tenantId = req.headers['x-tenant-id'] || 'default';
    const key = `${tenantId}:${ip}:${req.path.startsWith('/api/opportunities') ? 'ai' : 'general'}`;

    const now = Date.now();
    
    if (!store[key] || now > store[key].resetTime) {
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
    } else {
      store[key].count++;
    }

    // Standard RateLimit Headers
    res.setHeader('X-RateLimit-Limit', maxMax);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxMax - store[key].count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(store[key].resetTime / 1000));

    if (store[key].count > maxMax) {
      return res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: '请求过于频繁，触发系统防护阈值，请稍后再试。',
          retryAfterSeconds: Math.ceil((store[key].resetTime - now) / 1000)
        }
      });
    }

    next();
  };
}
