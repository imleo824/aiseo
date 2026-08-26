import { lookup } from 'dns/promises';
import { ValidationError } from '../domain/errors';

const isPrivateAddress = (address: string): boolean => {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  const [first, second] = address.split('.').map(Number);
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

/**
 * Resolves the hostname twice before an outbound WordPress call. It blocks
 * loopback/private targets and catches a common DNS-rebinding attempt. The
 * network egress policy remains the final boundary in production.
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
