import { Request, Response, NextFunction } from 'express';
import { getQueueConnection } from '../production/queue';

/**
 * Enterprise Rate Limiter Middleware
 * @param windowMs Window duration in milliseconds (default 60s)
 * @param maxMax Maximum requests permitted per window
 */
export function createRateLimiter(windowMs: number = 60000, maxMax: number = 300) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // req.ip uses the socket address unless the server has explicitly enabled a
    // trusted proxy hop. This keeps the limiter correct both locally and behind
    // Railway without accepting arbitrary X-Forwarded-For headers by default.
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const bucket = req.path.includes('/growth-programs') ? 'growth' : 'general';
    const key = `aiseo:rate:${bucket}:${ip}`;
    let count: number;
    let ttl: number;
    try {
      const redis = getQueueConnection();
      const result = await redis.multi().incr(key).pttl(key).exec();
      count = Number(result?.[0]?.[1] || 0);
      ttl = Number(result?.[1]?.[1] || -1);
      if (count === 1 || ttl < 0) {
        await redis.pexpire(key, windowMs);
        ttl = windowMs;
      }
    } catch {
      return res.status(503).json({ error: { code: 'RATE_LIMITER_UNAVAILABLE', message: '请求防护服务暂时不可用，请稍后重试。', traceId: req.traceId } });
    }

    // Standard RateLimit Headers
    res.setHeader('X-RateLimit-Limit', maxMax);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxMax - count));
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + ttl) / 1000));

    if (count > maxMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil(ttl / 1000));
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
