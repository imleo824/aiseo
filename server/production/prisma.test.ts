import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { retrySerializableOperation } from './prisma';

const serializationFailure = () => new Prisma.PrismaClientKnownRequestError('write conflict', {
  code: 'P2034',
  clientVersion: '6.12.0'
});
const uniqueRace = () => new Prisma.PrismaClientKnownRequestError('unique race', {
  code: 'P2002',
  clientVersion: '6.12.0'
});

describe('serializable transaction retry', () => {
  it('retries bounded PostgreSQL write conflicts', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValue('committed');
    await expect(retrySerializableOperation(operation)).resolves.toBe('committed');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry ordinary application failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('invalid input'));
    await expect(retrySerializableOperation(operation)).rejects.toThrow('invalid input');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('retries an idempotency-key unique race so the committed response can be replayed', async () => {
    const operation = vi.fn().mockRejectedValueOnce(uniqueRace()).mockResolvedValue('replayed');
    await expect(retrySerializableOperation(operation)).resolves.toBe('replayed');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
