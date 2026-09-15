const MICROS_PER_UNIT = 1_000_000n;
const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,6}))?$/;

const parseDecimal = (value: string): bigint => {
  const normalized = value.trim();
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) throw new Error('金额必须是普通十进制数字，且小数最多 6 位');

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || '').padEnd(6, '0'));
  return sign * (whole * MICROS_PER_UNIT + fraction);
};

/** Convert a user-facing decimal into the exact bigint-micro wire format. */
export const decimalToMicros = (value: string): string => parseDecimal(value).toString();

/** Convert an API bigint-micro value without ever passing through Number. */
export const microsToDecimal = (value: string | bigint): string => {
  const micros = typeof value === 'bigint' ? value : BigInt(value);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const whole = absolute / MICROS_PER_UNIT;
  const fraction = (absolute % MICROS_PER_UNIT).toString().padStart(6, '0').replace(/0+$/, '');
  const result = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && absolute !== 0n ? `-${result}` : result;
};

export const canonicalDecimal = (value: string): string => microsToDecimal(parseDecimal(value));

export const compareDecimals = (left: string, right: string): -1 | 0 | 1 => {
  const leftMicros = parseDecimal(left);
  const rightMicros = parseDecimal(right);
  return leftMicros < rightMicros ? -1 : leftMicros > rightMicros ? 1 : 0;
};

export const sumDecimals = (...values: string[]): string => (
  microsToDecimal(values.reduce((sum, value) => sum + parseDecimal(value), 0n))
);

export const absoluteDecimal = (value: string): string => {
  const micros = parseDecimal(value);
  return microsToDecimal(micros < 0n ? -micros : micros);
};

export const negateDecimal = (value: string): string => microsToDecimal(-parseDecimal(value));

export const divideDecimalByInteger = (value: string, divisor: number): string => {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('除数必须是正整数');
  const micros = parseDecimal(value);
  const divisorBigInt = BigInt(divisor);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const rounded = (absolute + divisorBigInt / 2n) / divisorBigInt;
  return microsToDecimal(negative ? -rounded : rounded);
};

export const formatDecimal = (value: string): string => {
  const canonical = canonicalDecimal(value);
  const negative = canonical.startsWith('-');
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [whole, fraction] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
};
