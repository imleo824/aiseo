import { createHash } from 'crypto';
import { ConflictError, ValidationError } from '../domain/errors';
import { prisma } from './prisma';

const requestHash = (body: unknown) => createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

export const requireIdempotencyKey = (value?: string): string => {
  const key = value?.trim();
  if (!key || key.length < 16 || key.length > 200) throw new ValidationError('写操作必须携带有效的 Idempotency-Key');
  return key;
};

export async function replayOrExecute<T extends object>(input: {
  organizationId: string;
  userId: string;
  key: string;
  body: unknown;
  execute: () => Promise<{ statusCode: number; response: T }>;
}): Promise<{ statusCode: number; response: T; replayed: boolean }> {
  const hash = requestHash(input.body);
  const existing = await prisma.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId: input.organizationId, key: input.key } } });
  if (existing) {
    if (existing.requestHash !== hash) throw new ConflictError('Idempotency-Key 已用于不同请求');
    if (existing.response && existing.statusCode) return { statusCode: existing.statusCode, response: existing.response as T, replayed: true };
    throw new ConflictError('相同请求正在处理，请稍后重试');
  }
  try {
    await prisma.idempotencyKey.create({ data: { organizationId: input.organizationId, userId: input.userId, key: input.key, requestHash: hash, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  } catch (error: any) {
    if (error?.code === 'P2002') return replayOrExecute(input);
    throw error;
  }
  const outcome = await input.execute();
  await prisma.idempotencyKey.update({ where: { organizationId_key: { organizationId: input.organizationId, key: input.key } }, data: { response: outcome.response, statusCode: outcome.statusCode } });
  return { ...outcome, replayed: false };
}
