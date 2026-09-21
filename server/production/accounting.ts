import { z } from 'zod';

export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const MAX_PACKAGE_BASE_MICROS = POSTGRES_BIGINT_MAX - 999_999n;
const POSITIVE_MICROS_PATTERN = /^[1-9]\d{0,18}$/;
const SIGNED_MICROS_PATTERN = /^-?[1-9]\d{0,18}$/;

export const CUSTOM_PAYMENT_PRICING_SETTING_KEY = 'payment.custom_pricing';
export const DEFAULT_CUSTOM_PAYMENT_PRICING = {
  active: true,
  minAmountMicros: '10000000',
  maxAmountMicros: '10000000000',
  creditsPerUsdtMicros: '100000000'
} as const;

const canonicalPositiveMicros = z.string()
  .regex(POSITIVE_MICROS_PATTERN, '微单位金额必须是无前导零的正整数字符串')
  .refine((value) => POSITIVE_MICROS_PATTERN.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX, '微单位金额超过数据库安全范围');

export const positiveAccountingMicrosSchema = canonicalPositiveMicros;

export const packageBaseMicrosSchema = canonicalPositiveMicros
  .refine((value) => POSITIVE_MICROS_PATTERN.test(value) && BigInt(value) % 1_000_000n === 0n, '套餐基础金额必须是整数 USDT')
  .refine((value) => POSITIVE_MICROS_PATTERN.test(value) && BigInt(value) <= MAX_PACKAGE_BASE_MICROS, '套餐基础金额没有预留唯一对账小数空间');

export const signedAccountingMicrosSchema = z.string()
  .regex(SIGNED_MICROS_PATTERN, '微单位调整金额必须是非零规范整数字符串')
  .refine((value) => {
    if (!SIGNED_MICROS_PATTERN.test(value)) return false;
    const amount = BigInt(value);
    const absolute = amount < 0n ? -amount : amount;
    return absolute <= POSTGRES_BIGINT_MAX;
  }, '微单位调整金额超过数据库安全范围');

export const paymentPackagePricingSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, '套餐 ID 格式无效'),
  name: z.string().trim().min(1).max(100),
  baseAmountMicros: packageBaseMicrosSchema,
  creditMicros: positiveAccountingMicrosSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000)
});

export const actionPricingSchema = z.object({
  action: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  creditMicros: positiveAccountingMicrosSchema,
  active: z.boolean()
});

export const customPaymentPricingSchema = z.object({
  active: z.boolean(),
  minAmountMicros: packageBaseMicrosSchema,
  maxAmountMicros: packageBaseMicrosSchema,
  creditsPerUsdtMicros: positiveAccountingMicrosSchema
}).superRefine((value, context) => {
  if (BigInt(value.minAmountMicros) > BigInt(value.maxAmountMicros)) {
    context.addIssue({ code: 'custom', path: ['maxAmountMicros'], message: '自定义充值上限不能小于下限' });
  }
});

export const parseCustomPaymentPricing = (value: unknown) => customPaymentPricingSchema.parse(
  value ?? DEFAULT_CUSTOM_PAYMENT_PRICING
);

export const pricingConfigurationSchema = z.object({
  packages: z.array(paymentPackagePricingSchema).min(1, '至少保留一个充值套餐').max(50),
  actions: z.array(actionPricingSchema).min(1, '至少保留一个计价动作').max(100),
  customPricing: customPaymentPricingSchema.default(DEFAULT_CUSTOM_PAYMENT_PRICING)
}).superRefine((value, context) => {
  const packageIds = new Set<string>();
  for (const item of value.packages) {
    if (packageIds.has(item.id)) context.addIssue({ code: 'custom', path: ['packages'], message: `套餐 ID 重复：${item.id}` });
    packageIds.add(item.id);
  }
  const actions = new Set<string>();
  for (const item of value.actions) {
    if (actions.has(item.action)) context.addIssue({ code: 'custom', path: ['actions'], message: `计价动作重复：${item.action}` });
    actions.add(item.action);
  }
});
