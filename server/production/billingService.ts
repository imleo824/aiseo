import { CreditHoldStatus, LedgerEntryType, PaymentStatus, Prisma, type PrismaClient } from '@prisma/client';
import { ConflictError, InsufficientCreditsError, NotFoundError, ValidationError } from '../domain/errors';
import { env } from './env';
import type { TransactionClient } from './prisma';

const USDT_MICROS = 1_000_000n;
const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;

export const formatMicros = (amount: bigint, scale = USDT_MICROS): string => {
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
};

// The transfer amount is an identifier as well as an amount. Never trim its
// six fractional digits in customer-facing payment instructions.
export const formatMicrosFixed = (amount: bigint, scale = USDT_MICROS): string => {
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(6, '0');
  return `${whole}.${fraction}`;
};

const paymentResponse = (payment: {
  id: string;
  packageId: string;
  recipientAddress: string;
  baseAmountMicros: bigint;
  expectedAmountMicros: bigint;
  creditMicros: bigint;
  status: PaymentStatus;
  expiresAt: Date;
}) => ({
  id: payment.id,
  packageId: payment.packageId,
  network: 'TRC20' as const,
  recipientAddress: payment.recipientAddress,
  baseAmountUsdt: formatMicros(payment.baseAmountMicros),
  expectedAmountUsdt: formatMicrosFixed(payment.expectedAmountMicros),
  creditMicros: payment.creditMicros.toString(),
  status: payment.status,
  expiresAt: payment.expiresAt.toISOString()
});

export const billingService = {
  async createPaymentIntent(tx: TransactionClient, organizationId: string, packageId: string) {
    if (!env.trc20RecipientAddress) throw new ValidationError('平台尚未配置 TRC20 收款地址');
    const paymentPackage = await tx.paymentPackage.findFirst({ where: { id: packageId, active: true } });
    if (!paymentPackage) throw new NotFoundError('充值套餐不存在或已停用');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aiseo-payment-amount-allocation'))`;
    const active = await tx.paymentIntent.findMany({
      where: {
        status: { in: [PaymentStatus.AWAITING_TRANSFER, PaymentStatus.VERIFYING, PaymentStatus.CONFIRMED] },
        baseAmountMicros: paymentPackage.baseAmountMicros
      },
      select: { expectedAmountMicros: true }
    });
    const used = new Set(active.map(({ expectedAmountMicros }) => expectedAmountMicros.toString()));
    let expectedAmountMicros: bigint | undefined;
    for (let suffix = 1n; suffix < USDT_MICROS; suffix += 1n) {
      const candidate = paymentPackage.baseAmountMicros + suffix;
      if (!used.has(candidate.toString())) {
        expectedAmountMicros = candidate;
        break;
      }
    }
    if (!expectedAmountMicros) throw new ConflictError('当前充值意图过多，请稍后再试');
    const payment = await tx.paymentIntent.create({
      data: {
        organizationId,
        packageId: paymentPackage.id,
        tokenContract: env.trc20UsdtContract,
        recipientAddress: env.trc20RecipientAddress,
        baseAmountMicros: paymentPackage.baseAmountMicros,
        expectedAmountMicros,
        creditMicros: paymentPackage.creditMicros,
        expiresAt: new Date(Date.now() + env.paymentIntentMinutes * 60_000)
      }
    });
    await tx.auditEvent.create({
      data: { organizationId, action: 'PAYMENT_INTENT_CREATED', targetType: 'payment_intent', targetId: payment.id }
    });
    return paymentResponse(payment);
  },

  async submitTransaction(tx: TransactionClient, organizationId: string, paymentIntentId: string, txHash: string) {
    if (!TX_HASH_PATTERN.test(txHash)) throw new ValidationError('TRC20 交易哈希格式无效');
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, organizationId } });
    if (!payment) throw new NotFoundError('充值意图不存在');
    if (payment.expiresAt <= new Date()) {
      await tx.paymentIntent.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } });
      throw new ConflictError('充值意图已过期');
    }
    if (payment.status === PaymentStatus.CREDITED) return paymentResponse(payment);
    try {
      const updated = await tx.paymentIntent.update({
        where: { id: payment.id },
        data: { txHash: txHash.toLowerCase(), status: PaymentStatus.VERIFYING, submittedAt: new Date() }
      });
      return paymentResponse(updated);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('该交易哈希已被使用');
      }
      throw error;
    }
  },

  async creditConfirmedPayment(database: PrismaClient, paymentIntentId: string, verification: Prisma.InputJsonValue): Promise<{ credited: boolean; balanceMicros: string }> {
    try {
      return await database.$transaction(async (tx) => {
        const paymentRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM public.payment_intents WHERE id = ${paymentIntentId}::uuid FOR UPDATE
        `;
        if (!paymentRows.length) throw new NotFoundError('充值意图不存在');
        const payment = await tx.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId } });
        if (payment.status === PaymentStatus.CREDITED) {
          const organization = await tx.organization.findUniqueOrThrow({ where: { id: payment.organizationId } });
          return { credited: false, balanceMicros: organization.creditBalanceMicros.toString() };
        }
        if (payment.status !== PaymentStatus.VERIFYING && payment.status !== PaymentStatus.CONFIRMED) {
          throw new ConflictError('充值意图状态不允许入账');
        }
        const organization = await tx.organization.update({
          where: { id: payment.organizationId },
          data: { creditBalanceMicros: { increment: payment.creditMicros } }
        });
        await tx.ledgerEntry.create({
          data: {
            organizationId: payment.organizationId,
            type: LedgerEntryType.PURCHASE,
            amountMicros: payment.creditMicros,
            balanceAfterMicros: organization.creditBalanceMicros,
            reason: '已核验 TRC20 USDT 充值',
            idempotencyKey: `payment-credit:${payment.id}`,
            paymentIntentId: payment.id,
            metadata: verification
          }
        });
        await tx.paymentIntent.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CREDITED, verification, confirmedAt: new Date(), creditedAt: new Date() }
        });
        await tx.auditEvent.create({
          data: { organizationId: payment.organizationId, action: 'PAYMENT_CREDITED', targetType: 'payment_intent', targetId: payment.id, metadata: verification }
        });
        return { credited: true, balanceMicros: organization.creditBalanceMicros.toString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const payment = await database.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId }, include: { organization: true } });
        return { credited: false, balanceMicros: payment.organization.creditBalanceMicros.toString() };
      }
      throw error;
    }
  },

  async reserveCredits(tx: TransactionClient, organizationId: string, jobRunId: string, amountMicros: bigint, reason: string): Promise<void> {
    if (amountMicros <= 0n) throw new ValidationError('信用占用金额必须为正数');
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { creditBalanceMicros: true } });
    const holds = await tx.creditHold.aggregate({ where: { organizationId, status: CreditHoldStatus.HELD }, _sum: { amountMicros: true } });
    const held = holds._sum.amountMicros || 0n;
    if (organization.creditBalanceMicros - held < amountMicros) throw new InsufficientCreditsError('可用积分不足');
    await tx.creditHold.create({ data: { organizationId, jobRunId, amountMicros, reason } });
  },

  async settleCreditHold(tx: TransactionClient, jobRunId: string, resultType: string, resultId: string): Promise<void> {
    const hold = await tx.creditHold.findUnique({ where: { jobRunId } });
    if (!hold || hold.status === CreditHoldStatus.SETTLED) return;
    if (hold.status !== CreditHoldStatus.HELD) throw new ConflictError('已释放的信用占用不能结算');
    const organization = await tx.organization.update({
      where: { id: hold.organizationId },
      data: { creditBalanceMicros: { decrement: hold.amountMicros } }
    });
    await tx.ledgerEntry.create({
      data: {
        organizationId: hold.organizationId,
        type: LedgerEntryType.CONSUMPTION,
        amountMicros: -hold.amountMicros,
        balanceAfterMicros: organization.creditBalanceMicros,
        reason: hold.reason,
        idempotencyKey: `hold-settlement:${hold.id}`,
        metadata: { jobRunId }
      }
    });
    await tx.usageRecord.create({ data: { organizationId: hold.organizationId, jobRunId, action: hold.reason, amountMicros: hold.amountMicros, resultType, resultId } });
    await tx.creditHold.update({ where: { id: hold.id }, data: { status: CreditHoldStatus.SETTLED, settledAt: new Date() } });
  },

  async releaseCreditHold(tx: TransactionClient, jobRunId: string): Promise<void> {
    await tx.creditHold.updateMany({ where: { jobRunId, status: CreditHoldStatus.HELD }, data: { status: CreditHoldStatus.RELEASED, releasedAt: new Date() } });
  }
};
