import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError, ValidationError } from '../domain/errors';
import { logger } from '../utils/logger';

export type ApiMeta = { nextCursor?: string; traceId?: string };

const jsonSafe = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
};

export const sendData = (response: Response, data: unknown, statusCode = 200, meta?: ApiMeta): void => {
  response.status(statusCode).json(jsonSafe({ data, ...(meta ? { meta } : {}) }));
};

export const asyncRoute = (
  handler: (request: Request, response: Response) => Promise<void>
): RequestHandler => (request, response, next) => void handler(request, response).catch(next);

export const parseBody = <T>(schema: ZodType<T>, request: Request): T => {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('请求参数无效', parsed.error.flatten());
  return parsed.data;
};

export const errorHandler = (error: unknown, request: Request, response: Response, _next: NextFunction): void => {
  const normalized = error instanceof ZodError
    ? new ValidationError('请求参数无效', error.flatten())
    : error;
  const appError = normalized instanceof AppError ? normalized : undefined;
  const statusCode = appError?.statusCode ?? 500;
  if (statusCode >= 500) {
    logger.error('API_ERROR', 'Unhandled API error', { traceId: request.traceId, data: normalized });
  }
  response.status(statusCode).json({
    error: {
      code: appError?.errorCode ?? 'INTERNAL_SERVER_ERROR',
      message: appError?.message ?? '服务器内部错误',
      ...(appError?.details === undefined ? {} : { details: jsonSafe(appError.details) }),
      traceId: request.traceId
    }
  });
};

export const cursorPage = (cursor: unknown, limit: unknown): { cursor?: string; take: number } => {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  return { cursor: typeof cursor === 'string' && cursor ? cursor : undefined, take };
};
