import { describe, expect, it } from 'vitest';
import {
  absoluteDecimal,
  canonicalDecimal,
  compareDecimals,
  decimalToMicros,
  divideDecimalByInteger,
  formatDecimal,
  microsToDecimal,
  negateDecimal,
  sumDecimals
} from './fixedDecimal';

describe('fixed decimal accounting helpers', () => {
  it('round-trips exact six-decimal values without Number', () => {
    expect(decimalToMicros('9007199254740993.123456')).toBe('9007199254740993123456');
    expect(microsToDecimal('9007199254740993123456')).toBe('9007199254740993.123456');
    expect(microsToDecimal('-1250000')).toBe('-1.25');
  });

  it('rejects exponent notation, excess precision and malformed input', () => {
    expect(() => decimalToMicros('1e3')).toThrow();
    expect(() => decimalToMicros('1.0000001')).toThrow();
    expect(() => decimalToMicros('1,000')).toThrow();
    expect(() => decimalToMicros('')).toThrow();
  });

  it('performs exact signed arithmetic and comparisons', () => {
    expect(sumDecimals('0.1', '0.2', '9007199254740993')).toBe('9007199254740993.3');
    expect(compareDecimals('99.999999', '100')).toBe(-1);
    expect(absoluteDecimal('-12.5')).toBe('12.5');
    expect(negateDecimal('12.5')).toBe('-12.5');
    expect(canonicalDecimal('-0.000000')).toBe('0');
  });

  it('formats and averages using bigint micros', () => {
    expect(formatDecimal('1234567890123456.25')).toBe('1,234,567,890,123,456.25');
    expect(divideDecimalByInteger('10', 3)).toBe('3.333333');
    expect(divideDecimalByInteger('2', 3)).toBe('0.666667');
  });
});
