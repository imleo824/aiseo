import { CreditHoldStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionClient } from './prisma';
import { billingService } from './billingService';

const transaction = (balance: bigint, held: bigint) => {
  const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
  const create = vi.fn().mockResolvedValue({ id: 'hold' });
  const tx = {
    $queryRaw: queryRaw,
    organization: { findUnique: vi.fn().mockResolvedValue({ id: 'organization', creditBalanceMicros: balance }) },
    creditHold: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amountMicros: held } }),
      create
    }
  } as unknown as TransactionClient;
  return { tx, queryRaw, create };
};

describe('credit reservation', () => {
  it('locks the organization balance before calculating available credits', async () => {
    const { tx, queryRaw, create } = transaction(1_000n, 400n);
    await billingService.reserveCredits(tx, '10000000-0000-4000-8000-000000000001', 'job-1', 600n, 'GROWTH_RUN');
    expect(queryRaw).toHaveBeenCalledOnce();
    expect((queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain('pg_advisory_xact_lock');
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects a reservation that would exceed the locked available balance', async () => {
    const { tx, create } = transaction(1_000n, 401n);
    await expect(billingService.reserveCredits(tx, '10000000-0000-4000-8000-000000000001', 'job-2', 600n, 'GROWTH_RUN'))
      .rejects.toThrow('可用积分不足');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('credit hold finalization', () => {
  it('re-checks the hold under the organization lock before settlement', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    const debit = vi.fn();
    const tx = {
      $queryRaw: queryRaw,
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'organization', creditBalanceMicros: 1_000n }),
        update: debit
      },
      creditHold: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: 'hold', organizationId: 'organization', status: CreditHoldStatus.HELD, amountMicros: 100n })
          .mockResolvedValueOnce({ id: 'hold', organizationId: 'organization', status: CreditHoldStatus.RELEASED, amountMicros: 100n })
      }
    } as unknown as TransactionClient;

    await expect(billingService.settleCreditHold(tx, 'job', 'content_draft', 'draft'))
      .rejects.toThrow('已释放的信用占用不能结算');
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(debit).not.toHaveBeenCalled();
  });

  it('serializes release with settlement and updates only a still-held row', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: queryRaw,
      organization: { findUnique: vi.fn().mockResolvedValue({ id: 'organization', creditBalanceMicros: 1_000n }) },
      creditHold: {
        findUnique: vi.fn().mockResolvedValue({ id: 'hold', organizationId: 'organization', status: CreditHoldStatus.HELD }),
        updateMany
      }
    } as unknown as TransactionClient;

    await billingService.releaseCreditHold(tx, 'job');
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobRunId: 'job', status: CreditHoldStatus.HELD }
    }));
  });
});
