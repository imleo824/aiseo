import { Prisma, LedgerEntryType, PaymentStatus, CreditHoldStatus } from '@prisma/client';
import { ConflictError, InsufficientCreditsError, NotFoundError, ValidationError } from '../domain/errors';
import { env } from './env';
import { prisma } from './prisma';
import type { PaymentIntentResponse } from './contracts';

const USDT_MICROS = 1_000_000n;
const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

export const parseUsdtMicros = (amount: unknown): bigint => {
  const normalized = String(amount ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) throw new ValidationError('USDT 金额最多支持 6 位小数');
  const [whole, fraction = ''] = normalized.split('.');
  const value = BigInt(whole) * USDT_MICROS + BigInt(fraction.padEnd(6, '0'));
  if (value <= 0n || value > 100_000n * USDT_MICROS) throw new ValidationError('USDT 金额不在允许范围内');
  return value;
};

export const formatUsdtMicros = (amount: bigint): string => {
  const whole = amount / USDT_MICROS;
  const fraction = (amount % USDT_MICROS).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

const toPaymentResponse = (payment: { id: string; network: string; recipientAddress: string; expectedAmountMicros: bigint; credits: number; status: PaymentStatus; expiresAt: Date }): PaymentIntentResponse => ({
  id: payment.id,
  network: 'TRC20',
  recipientAddress: payment.recipientAddress,
  expectedAmountUsdt: formatUsdtMicros(payment.expectedAmountMicros),
  credits: payment.credits,
  status: payment.status,
  expiresAt: payment.expiresAt.toISOString()
});

export const billingService = {
  async createPaymentIntent(organizationId: string, amount: unknown): Promise<PaymentIntentResponse> {
    if (!env.trc20RecipientAddress) throw new ValidationError('平台尚未配置 TRC20 收款地址');
    const expectedAmountMicros = parseUsdtMicros(amount);
    if (expectedAmountMicros % USDT_MICROS !== 0n) {
      throw new ValidationError('当前积分套餐仅支持整数 USDT 金额');
    }
    const credits = Number(expectedAmountMicros / USDT_MICROS) * 100;
    const payment = await prisma.paymentIntent.create({
      data: {
        organizationId,
        recipientAddress: env.trc20RecipientAddress,
        expectedAmountMicros,
        credits,
        status: PaymentStatus.AWAITING_CONFIRMATION,
        expiresAt: new Date(Date.now() + env.paymentIntentMinutes * 60 * 1000)
      }
    });
    await prisma.auditEvent.create({ data: { organizationId, action: 'PAYMENT_INTENT_CREATED', targetType: 'payment_intent', targetId: payment.id, metadata: { credits } } });
    return toPaymentResponse(payment);
  },

  async attachTransactionHash(organizationId: string, paymentId: string, txHash: string): Promise<void> {
    if (!TX_HASH_PATTERN.test(txHash)) throw new ValidationError('TRC20 交易哈希格式无效');
    const payment = await prisma.paymentIntent.findFirst({ where: { id: paymentId, organizationId } });
    if (!payment) throw new NotFoundError('充值意图不存在');
    if (payment.expiresAt <= new Date()) {
      await prisma.paymentIntent.update({ where: { id: paymentId }, data: { status: PaymentStatus.EXPIRED } });
      throw new ValidationError('充值意图已过期，请重新创建');
    }
    if (payment.status === PaymentStatus.CREDITED) return;
    try {
      await prisma.paymentIntent.update({ where: { id: paymentId }, data: { txHash: txHash.toLowerCase(), status: PaymentStatus.AWAITING_CONFIRMATION } });
    } catch (error: any) {
      if (error?.code === 'P2002') throw new ConflictError('该链上交易已被其他充值意图使用');
      throw error;
    }
  },

  async creditVerifiedPayment(paymentId: string, verification: Prisma.InputJsonValue): Promise<{ credited: boolean; balance: number }> {
    try {
      return await prisma.$transaction(async (tx) => {
        const payment = await tx.paymentIntent.findUnique({ where: { id: paymentId } });
        if (!payment) throw new NotFoundError('充值意图不存在');
        if (payment.status === PaymentStatus.CREDITED) {
          const organization = await tx.organization.findUniqueOrThrow({ where: { id: payment.organizationId } });
          return { credited: false, balance: organization.creditBalance };
        }
        if (payment.status === PaymentStatus.EXPIRED || payment.status === PaymentStatus.REJECTED) throw new ConflictError('该充值意图不可再入账');
        const organization = await tx.organization.update({ where: { id: payment.organizationId }, data: { creditBalance: { increment: payment.credits } } });
        await tx.ledgerEntry.create({
          data: {
            organizationId: payment.organizationId,
            type: LedgerEntryType.CREDIT,
            amount: payment.credits,
            balanceAfter: organization.creditBalance,
            reason: '已核验的 TRC20 USDT 充值',
            paymentIntentId: payment.id,
            idempotencyKey: `payment-credit:${payment.id}`,
            metadata: verification
          }
        });
        await tx.paymentIntent.update({ where: { id: payment.id }, data: { status: PaymentStatus.CREDITED, verification, verifiedAt: new Date(), creditedAt: new Date() } });
        await tx.auditEvent.create({ data: { organizationId: payment.organizationId, action: 'PAYMENT_CREDITED', targetType: 'payment_intent', targetId: payment.id, metadata: verification } });
        return { credited: true, balance: organization.creditBalance };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: paymentId }, include: { organization: true } });
        return { credited: false, balance: payment.organization.creditBalance };
      }
      throw error;
    }
  },

  async reserveCredits(organizationId: string, jobRunId: string, amount: number, reason: string): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('预占积分必须为正整数');
    await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { creditBalance: true } });
      const holds = await tx.creditHold.aggregate({ where: { organizationId, status: CreditHoldStatus.HELD }, _sum: { amount: true } });
      if (organization.creditBalance - (holds._sum.amount || 0) < amount) throw new InsufficientCreditsError('可用积分不足，无法创建 SEO 数据任务');
      await tx.creditHold.create({ data: { organizationId, jobRunId, amount, reason } });
      await tx.auditEvent.create({ data: { organizationId, action: 'CREDIT_HELD', targetType: 'job_run', targetId: jobRunId, metadata: { amount, reason } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async settleCreditHold(jobRunId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const hold = await tx.creditHold.findUnique({ where: { jobRunId } });
      if (!hold || hold.status === CreditHoldStatus.SETTLED) return;
      if (hold.status !== CreditHoldStatus.HELD) throw new ConflictError('积分预占已释放，不能结算');
      const organization = await tx.organization.update({ where: { id: hold.organizationId }, data: { creditBalance: { decrement: hold.amount } } });
      await tx.ledgerEntry.create({ data: { organizationId: hold.organizationId, type: LedgerEntryType.CONSUMPTION, amount: -hold.amount, balanceAfter: organization.creditBalance, reason: hold.reason, idempotencyKey: `hold-settlement:${hold.id}`, metadata: { jobRunId } } });
      await tx.creditHold.update({ where: { id: hold.id }, data: { status: CreditHoldStatus.SETTLED, settledAt: new Date() } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  },

  async releaseCreditHold(jobRunId: string): Promise<void> {
    await prisma.creditHold.updateMany({ where: { jobRunId, status: CreditHoldStatus.HELD }, data: { status: CreditHoldStatus.RELEASED, releasedAt: new Date() } });
  }
};
