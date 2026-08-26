import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditHoldStatus, PaymentStatus } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  paymentIntent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn()
  },
  organization: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn()
  },
  ledgerEntry: { create: vi.fn() },
  creditHold: { aggregate: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  auditEvent: { create: vi.fn() },
  transaction: vi.fn()
}));

vi.mock('./env', () => ({
  env: {
    trc20RecipientAddress: 'TRc20RecipientAddress111111111111111',
    paymentIntentMinutes: 30
  }
}));

vi.mock('./prisma', () => ({
  prisma: {
    paymentIntent: mocks.paymentIntent,
    organization: mocks.organization,
    ledgerEntry: mocks.ledgerEntry,
    creditHold: mocks.creditHold,
    auditEvent: mocks.auditEvent,
    $transaction: mocks.transaction
  }
}));

import { billingService, formatUsdtMicros, parseUsdtMicros } from './billingService';

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1',
  organizationId: 'org-1',
  network: 'TRC20',
  recipientAddress: 'TRc20RecipientAddress111111111111111',
  expectedAmountMicros: 12_345_600n,
  credits: 1200,
  status: PaymentStatus.AWAITING_CONFIRMATION,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (operation: (tx: unknown) => unknown) => operation({
    paymentIntent: mocks.paymentIntent,
    organization: mocks.organization,
    ledgerEntry: mocks.ledgerEntry,
    creditHold: mocks.creditHold,
    auditEvent: mocks.auditEvent
  }));
});

describe('USDT amount contract', () => {
  it('uses integer micro-USDT values and rejects unsafe input', () => {
    expect(parseUsdtMicros('12.3456')).toBe(12_345_600n);
    expect(formatUsdtMicros(12_345_600n)).toBe('12.3456');
    expect(formatUsdtMicros(1_000_000n)).toBe('1');
    for (const amount of ['', '-1', '1.1234567', 'not-a-number', '100001']) {
      expect(() => parseUsdtMicros(amount)).toThrow();
    }
  });
});

describe('payment intent and transaction-hash state machine', () => {
  it('creates a pending intent and immutable audit event', async () => {
    mocks.paymentIntent.create.mockResolvedValue(payment({ expectedAmountMicros: 12_000_000n, credits: 1200 }));
    const intent = await billingService.createPaymentIntent('org-1', '12');
    expect(intent).toMatchObject({ network: 'TRC20', expectedAmountUsdt: '12', credits: 1200, status: PaymentStatus.AWAITING_CONFIRMATION });
    expect(mocks.paymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-1', expectedAmountMicros: 12_000_000n, credits: 1200 })
    }));
    expect(mocks.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_INTENT_CREATED' }) }));
  });

  it('rejects fractional USDT instead of silently truncating the credited amount', async () => {
    await expect(billingService.createPaymentIntent('org-1', '12.5')).rejects.toThrow('仅支持整数 USDT');
    expect(mocks.paymentIntent.create).not.toHaveBeenCalled();
  });

  it('only attaches valid, unique hashes to an active intent', async () => {
    await expect(billingService.attachTransactionHash('org-1', 'payment-1', 'bad')).rejects.toThrow('交易哈希格式无效');
    mocks.paymentIntent.findFirst.mockResolvedValue(payment());
    const hash = 'A'.repeat(64);
    await billingService.attachTransactionHash('org-1', 'payment-1', hash);
    expect(mocks.paymentIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ txHash: hash.toLowerCase() }) }));

    mocks.paymentIntent.findFirst.mockResolvedValue(null);
    await expect(billingService.attachTransactionHash('org-1', 'payment-1', hash)).rejects.toThrow('充值意图不存在');

    mocks.paymentIntent.findFirst.mockResolvedValue(payment({ expiresAt: new Date(Date.now() - 1) }));
    await expect(billingService.attachTransactionHash('org-1', 'payment-1', hash)).rejects.toThrow('已过期');
    expect(mocks.paymentIntent.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: PaymentStatus.EXPIRED } }));

    const updatesBeforeCreditedReplay = mocks.paymentIntent.update.mock.calls.length;
    mocks.paymentIntent.findFirst.mockResolvedValue(payment({ status: PaymentStatus.CREDITED }));
    await expect(billingService.attachTransactionHash('org-1', 'payment-1', hash)).resolves.toBeUndefined();
    expect(mocks.paymentIntent.update).toHaveBeenCalledTimes(updatesBeforeCreditedReplay);

    mocks.paymentIntent.findFirst.mockResolvedValue(payment());
    mocks.paymentIntent.update.mockRejectedValueOnce({ code: 'P2002' });
    await expect(billingService.attachTransactionHash('org-1', 'payment-1', hash)).rejects.toThrow('已被其他充值意图使用');
  });
});

describe('ledger and credit-hold invariants', () => {
  it('credits a verified payment once, and is idempotent afterwards', async () => {
    mocks.paymentIntent.findUnique.mockResolvedValueOnce(payment());
    mocks.organization.update.mockResolvedValueOnce({ creditBalance: 1300 });
    const verification = { txHash: 'a'.repeat(64), confirmed: true };
    await expect(billingService.creditVerifiedPayment('payment-1', verification)).resolves.toEqual({ credited: true, balance: 1300 });
    expect(mocks.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CREDIT', amount: 1200, idempotencyKey: 'payment-credit:payment-1' }) }));
    expect(mocks.paymentIntent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: PaymentStatus.CREDITED, verification }) }));

    mocks.paymentIntent.findUnique.mockResolvedValueOnce(payment({ status: PaymentStatus.CREDITED }));
    mocks.organization.findUniqueOrThrow.mockResolvedValueOnce({ creditBalance: 1300 });
    await expect(billingService.creditVerifiedPayment('payment-1', verification)).resolves.toEqual({ credited: false, balance: 1300 });

    mocks.paymentIntent.findUnique.mockResolvedValueOnce(payment({ status: PaymentStatus.REJECTED }));
    await expect(billingService.creditVerifiedPayment('payment-1', verification)).rejects.toThrow('不可再入账');
  });

  it('handles a duplicate credit write by returning the projected balance', async () => {
    mocks.transaction.mockRejectedValueOnce({ code: 'P2002' });
    mocks.paymentIntent.findUniqueOrThrow.mockResolvedValueOnce({ organization: { creditBalance: 1300 } });
    await expect(billingService.creditVerifiedPayment('payment-1', {})).resolves.toEqual({ credited: false, balance: 1300 });
  });

  it('reserves only available credits and creates a hold audit record', async () => {
    mocks.organization.findUniqueOrThrow.mockResolvedValue({ creditBalance: 10 });
    mocks.creditHold.aggregate.mockResolvedValue({ _sum: { amount: 3 } });
    await billingService.reserveCredits('org-1', 'job-1', 5, 'SERP task');
    expect(mocks.creditHold.create).toHaveBeenCalledWith({ data: { organizationId: 'org-1', jobRunId: 'job-1', amount: 5, reason: 'SERP task' } });

    mocks.creditHold.aggregate.mockResolvedValue({ _sum: { amount: 9 } });
    await expect(billingService.reserveCredits('org-1', 'job-2', 5, 'SERP task')).rejects.toThrow('可用积分不足');
    await expect(billingService.reserveCredits('org-1', 'job-2', 0, 'SERP task')).rejects.toThrow('正整数');
  });

  it('settles held credits once and never charges released holds', async () => {
    mocks.creditHold.findUnique.mockResolvedValueOnce({ id: 'hold-1', organizationId: 'org-1', jobRunId: 'job-1', amount: 5, reason: 'SERP task', status: CreditHoldStatus.HELD });
    mocks.organization.update.mockResolvedValueOnce({ creditBalance: 95 });
    await billingService.settleCreditHold('job-1');
    expect(mocks.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: -5, idempotencyKey: 'hold-settlement:hold-1' }) }));
    expect(mocks.creditHold.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: CreditHoldStatus.SETTLED }) }));

    mocks.creditHold.findUnique.mockResolvedValueOnce({ id: 'hold-2', organizationId: 'org-1', amount: 5, reason: 'SERP task', status: CreditHoldStatus.RELEASED });
    await expect(billingService.settleCreditHold('job-2')).rejects.toThrow('已释放');
    await billingService.releaseCreditHold('job-1');
    expect(mocks.creditHold.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobRunId: 'job-1', status: CreditHoldStatus.HELD }, data: expect.objectContaining({ status: CreditHoldStatus.RELEASED }) }));
  });
});
