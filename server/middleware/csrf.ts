import type { NextFunction, Request, Response } from 'express';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const hasSessionCookie = (request: Request): boolean =>
  /(?:^|;\s*)seo_session=[^;]+/.test(request.headers.cookie || '');

const requestOrigin = (request: Request): string => {
  const configuredOrigin = process.env.APP_BASE_URL?.trim();
  if (configuredOrigin) return new URL(configuredOrigin).origin;

  const host = request.get('host');
  if (!host) return '';
  const forwardedProtocol = request.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || request.protocol || 'http';
  return `${protocol}://${host}`;
};

/**
 * Cookie-authenticated browser writes need an origin check. Bearer-token callers
 * are intentionally left alone so a future server-to-server API is not coupled
 * to browser Origin semantics.
 */
export const requireSameOriginForCookieWrites = (request: Request, response: Response, next: NextFunction): void => {
  if (!UNSAFE_METHODS.has(request.method) || !hasSessionCookie(request) || request.headers.authorization) {
    next();
    return;
  }

  const origin = request.get('origin');
  const expectedOrigin = requestOrigin(request);
  if (origin && expectedOrigin && origin === expectedOrigin) {
    next();
    return;
  }

  response.status(403).json({
    success: false,
    error: {
      code: 'CSRF_ORIGIN_REJECTED',
      message: '请求来源校验失败，请刷新页面后重试。'
    }
  });
};
