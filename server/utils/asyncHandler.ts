import { Request, Response, NextFunction } from 'express';
import { TenantRequest } from '../middleware/tenant';
import { AppError } from '../domain/errors';
import { logger } from './logger';

export const asyncHandler = (fn: (req: TenantRequest, res: Response, next: NextFunction) => any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const tenantReq = req as TenantRequest;
    const traceId = tenantReq.traceId || (req.headers['x-request-id'] as string) || `req-${Date.now()}`;
    const start = Date.now();

    Promise.resolve(fn(tenantReq, res, next)).catch((error: any) => {
      const elapsedMs = Date.now() - start;

      if (error instanceof AppError) {
        logger.warn('API_HANDLER', `Client error: ${error.message} [${error.errorCode}]`, {
          traceId,
          tenantId: tenantReq.tenantId,
          durationMs: elapsedMs
        });
        return res.status(error.statusCode).json(error.toJSON(traceId));
      }

      logger.error('API_HANDLER', `Unhandled exception: ${error?.message || error}`, {
        traceId,
        tenantId: tenantReq.tenantId,
        durationMs: elapsedMs,
        data: error?.stack || error
      });

      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message || 'An unexpected internal error occurred.',
          statusCode: 500,
          timestamp: new Date().toISOString(),
          traceId
        }
      });
    });
  };
};
