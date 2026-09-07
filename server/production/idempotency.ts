import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { ConflictError, ValidationError } from '../domain/errors';
import type { TransactionClient } from './prisma';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const canonicalJsonValue = (value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]));
  }
  return value;
};
export const idempotencyRequestHash = (body: unknown): string => createHash('sha256')
  .update(JSON.stringify(canonicalJsonValue(body ?? {})))
  .digest('hex');

export const requireIdempotencyKey = (value?: string): string => {
  const key = value?.trim();
  if (!key || !UUID_PATTERN.test(key)) throw new ValidationError('写操作必须携带 UUID Idempotency-Key');
  return key.toLowerCase();
};

export async function executeIdempotent<T extends Record<string, unknown>>(input: {
  tx: TransactionClient;
  organizationId?: string;
  profileId: string;
  key: string;
  body: unknown;
  execute: () => Promise<{ statusCode: number; data: T }>;
}): Promise<{ statusCode: number; data: T; replayed: boolean }> {
  const hash = idempotencyRequestHash(input.body);
  const existing = await input.tx.idempotencyKey.findFirst({
    where: { organizationId: input.organizationId ?? null, profileId: input.profileId, key: input.key }
  });
  if (existing) {
    if (existing.requestHash !== hash) throw new ConflictError('Idempotency-Key 已用于不同请求');
    if (existing.response && existing.statusCode) {
      return { statusCode: existing.statusCode, data: existing.response as T, replayed: true };
    }
    throw new ConflictError('相同请求正在处理');
  }
  const outcome = await input.execute();
  const persistedResponse = canonicalJsonValue(outcome.data) as Prisma.InputJsonValue;
  await input.tx.idempotencyKey.create({
    data: {
      organizationId: input.organizationId ?? null,
      profileId: input.profileId,
      key: input.key,
      requestHash: hash,
      response: persistedResponse,
      statusCode: outcome.statusCode,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });
  return { ...outcome, replayed: false };
}
