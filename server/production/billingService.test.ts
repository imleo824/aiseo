import { CreditHoldStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionClient } from './prisma';
import { billingService } from './billingService';

vi.mock('./env', () => ({
  env: {
    trc20RecipientAddress: 'TRecipient',
    trc20UsdtContract: 'TUsdtContract',
    paymentIntentMinutes: 30
  }
}));

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

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '10000000-0000-4000-8000-000000000010',
  organizationId: '10000000-0000-4000-8000-000000000001',
  packageId: 'starter',
  recipientAddress: 'TRecipient',
  baseAmountMicros: 10_000_000n,
  expectedAmountMicros: 10_000_001n,
  creditMicros: 100_000_000n,
  txHash: null,
  status: PaymentStatus.AWAITING_TRANSFER,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides
});

describe('payment intent pricing', () => {
  it('creates a custom intent from the database rate without pretending it is a package', async () => {
    const createdAt = new Date('2026-09-21T00:00:00.000Z');
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({
      id: '10000000-0000-4000-8000-000000000010',
      status: PaymentStatus.AWAITING_TRANSFER,
      expiresAt: data.expiresAt,
      ...data
    }));
    const tx = {
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { active: true, minAmountMicros: '10000000', maxAmountMicros: '10000000000', creditsPerUsdtMicros: '100000000' }, updatedAt: createdAt }) },
      paymentIntent: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
      $executeRaw: vi.fn().mockResolvedValue(1)
    } as unknown as TransactionClient;

    const result = await billingService.createPaymentIntent(tx, '10000000-0000-4000-8000-000000000001', { customAmountMicros: '80000000' });

    expect(result).toMatchObject({ packageId: null, pricingSource: 'CUSTOM', baseAmountUsdt: '80', expectedAmountUsdt: '80.000001', creditMicros: '8000000000' });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ packageId: null, pricingSource: 'CUSTOM', baseAmountMicros: 80_000_000n, creditMicros: 8_000_000_000n }) });
  });

  it('rejects custom amounts outside the configured whole-USDT range', async () => {
    const tx = {
      systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { active: true, minAmountMicros: '10000000', maxAmountMicros: '100000000', creditsPerUsdtMicros: '100000000' }, updatedAt: new Date() }) }
    } as unknown as TransactionClient;
    await expect(billingService.createPaymentIntent(tx, '10000000-0000-4000-8000-000000000001', { customAmountMicros: '9000001' }))
      .rejects.toThrow('整数 USDT');
    await expect(billingService.createPaymentIntent(tx, '10000000-0000-4000-8000-000000000001', { customAmountMicros: '200000000' }))
      .rejects.toThrow('必须在 10–100 USDT 之间');
  });
});

describe('payment transaction submission', () => {
  const firstHash = 'a'.repeat(64);
  const secondHash = 'b'.repeat(64);

  it('claims an awaiting intent once and writes an audit event', async () => {
    const awaiting = payment();
    const verifying = payment({ txHash: firstHash, status: PaymentStatus.VERIFYING });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit' });
    const tx = {
      paymentIntent: {
        findFirst: vi.fn().mockResolvedValueOnce(awaiting).mockResolvedValueOnce(verifying),
        updateMany
      },
      auditEvent: { create: auditCreate }
    } as unknown as TransactionClient;

    const result = await billingService.submitTransaction(tx, awaiting.organizationId, awaiting.id, firstHash.toUpperCase());

    expect(result.status).toBe(PaymentStatus.VERIFYING);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: PaymentStatus.AWAITING_TRANSFER, txHash: null }),
      data: expect.objectContaining({ txHash: firstHash, status: PaymentStatus.VERIFYING })
    }));
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('replays the same hash but refuses to replace a hash under verification', async () => {
    const verifying = payment({ txHash: firstHash, status: PaymentStatus.VERIFYING });
    const tx = { paymentIntent: { findFirst: vi.fn().mockResolvedValue(verifying) } } as unknown as TransactionClient;

    await expect(billingService.submitTransaction(tx, verifying.organizationId, verifying.id, firstHash)).resolves.toMatchObject({ status: PaymentStatus.VERIFYING });
    await expect(billingService.submitTransaction(tx, verifying.organizationId, verifying.id, secondHash)).rejects.toThrow('正在核验其他交易哈希');
  });

  it('never reopens a rejected or expired payment intent', async () => {
    for (const status of [PaymentStatus.REJECTED, PaymentStatus.EXPIRED]) {
      const terminal = payment({ txHash: firstHash, status });
      const tx = { paymentIntent: { findFirst: vi.fn().mockResolvedValue(terminal) } } as unknown as TransactionClient;
      await expect(billingService.submitTransaction(tx, terminal.organizationId, terminal.id, firstHash)).rejects.toThrow('充值意图已结束');
    }
  });

  it('returns a concurrent claim only when it uses the identical hash', async () => {
    const awaiting = payment();
    const verifying = payment({ txHash: firstHash, status: PaymentStatus.VERIFYING });
    const tx = {
      paymentIntent: {
        findFirst: vi.fn().mockResolvedValueOnce(awaiting).mockResolvedValueOnce(verifying),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      }
    } as unknown as TransactionClient;

    await expect(billingService.submitTransaction(tx, awaiting.organizationId, awaiting.id, firstHash)).resolves.toMatchObject({ status: PaymentStatus.VERIFYING });
  });
});
