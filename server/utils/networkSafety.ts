import { lookup } from 'dns/promises';
import { ValidationError } from '../domain/errors';

const isNonPublicIpv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
};

const isPrivateAddress = (address: string): boolean => {
  if (!address.includes(':')) return isNonPublicIpv4(address);
  const normalized = address.toLowerCase().split('%')[0];
  const embeddedIpv4 = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embeddedIpv4 && isNonPublicIpv4(embeddedIpv4)) return true;
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const value = (Number.parseInt(mappedHex[1], 16) << 16) + Number.parseInt(mappedHex[2], 16);
    const mappedIpv4 = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
    return isNonPublicIpv4(mappedIpv4);
  }
  const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('2001:db8:')
    || (firstGroup >= 0xfc00 && firstGroup <= 0xfdff)
    || (firstGroup >= 0xfe80 && firstGroup <= 0xfebf)
    || (firstGroup >= 0xff00 && firstGroup <= 0xffff);
};

/**
 * Repeats DNS resolution before an outbound customer-controlled request and
 * rejects every non-public answer, including mapped IPv4 and reserved ranges.
 * The deployment network egress policy remains the final rebinding boundary.
 */
export const resolvePublicHttpsOrigin = async (value: string): Promise<string> => {
  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    throw new ValidationError('WordPress 域名格式无效');
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) {
    throw new ValidationError('WordPress 域名必须是公网 HTTPS 域名');
  }

  const [firstLookup, secondLookup] = await Promise.all([
    lookup(url.hostname, { all: true, verbatim: true }),
    lookup(url.hostname, { all: true, verbatim: true })
  ]);
  const addresses = [...firstLookup, ...secondLookup];
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ValidationError('WordPress 域名不能解析到私有网络地址');
  }

  return url.origin;
};
