import { describe, expect, it } from 'vitest';
import {
  packageBaseMicrosSchema,
  customPaymentPricingSchema,
  pricingConfigurationSchema,
  positiveAccountingMicrosSchema,
  POSTGRES_BIGINT_MAX,
  signedAccountingMicrosSchema
} from './accounting';

describe('accounting wire schemas', () => {
  it('accepts canonical bigint micro strings', () => {
    expect(positiveAccountingMicrosSchema.parse('1')).toBe('1');
    expect(signedAccountingMicrosSchema.parse('-1000000')).toBe('-1000000');
    expect(positiveAccountingMicrosSchema.parse(POSTGRES_BIGINT_MAX.toString())).toBe(POSTGRES_BIGINT_MAX.toString());
  });

  it('rejects zero, signs, leading zeroes, decimals and bigint overflow', () => {
    for (const value of ['0', '+1', '01', '1.5', '1e6', '9223372036854775808']) {
      expect(positiveAccountingMicrosSchema.safeParse(value).success).toBe(false);
    }
    expect(signedAccountingMicrosSchema.safeParse('-0').success).toBe(false);
    expect(signedAccountingMicrosSchema.safeParse('-9223372036854775808').success).toBe(false);
  });

  it('requires whole-USDT package bases and reserves suffix space', () => {
    expect(packageBaseMicrosSchema.parse('200000000')).toBe('200000000');
    expect(packageBaseMicrosSchema.safeParse('200000001').success).toBe(false);
    expect(packageBaseMicrosSchema.safeParse(POSTGRES_BIGINT_MAX.toString()).success).toBe(false);
  });

  it('requires bounded whole-USDT custom pricing and an exact credit rate', () => {
    expect(customPaymentPricingSchema.parse({
      active: true,
      minAmountMicros: '10000000',
      maxAmountMicros: '10000000000',
      creditsPerUsdtMicros: '100000000'
    }).active).toBe(true);
    expect(customPaymentPricingSchema.safeParse({
      active: true,
      minAmountMicros: '10000001',
      maxAmountMicros: '10000000000',
      creditsPerUsdtMicros: '100000000'
    }).success).toBe(false);
    expect(customPaymentPricingSchema.safeParse({
      active: true,
      minAmountMicros: '20000000',
      maxAmountMicros: '10000000',
      creditsPerUsdtMicros: '100000000'
    }).success).toBe(false);
  });

  it('rejects duplicate identifiers in an atomic pricing update', () => {
    const duplicate = pricingConfigurationSchema.safeParse({
      packages: [
        { id: 'starter', name: 'A', baseAmountMicros: '1000000', creditMicros: '1000000', active: true, sortOrder: 0 },
        { id: 'starter', name: 'B', baseAmountMicros: '2000000', creditMicros: '2000000', active: true, sortOrder: 1 }
      ],
      actions: []
    });
    expect(duplicate.success).toBe(false);
  });

  it('requires a complete non-empty package and action configuration', () => {
    const packageOnly = pricingConfigurationSchema.safeParse({
      packages: [{ id: 'starter', name: 'Starter', baseAmountMicros: '1000000', creditMicros: '1000000', active: true, sortOrder: 0 }],
      actions: []
    });
    const actionOnly = pricingConfigurationSchema.safeParse({
      packages: [],
      actions: [{ action: 'GROWTH_RUN', name: 'Growth run', creditMicros: '1000000', description: '', active: true }]
    });
    expect(packageOnly.success).toBe(false);
    expect(actionOnly.success).toBe(false);
  });
});
