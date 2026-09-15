import { isIP } from 'node:net';
import { ValidationError } from '../domain/errors';

const PUBLIC_HOST_LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Canonicalize a customer site to the hostname persisted by AISEO.
 *
 * A Site represents one public HTTPS origin. Paths, ports, credentials and IP
 * literals are rejected so WordPress/GSC evidence cannot silently move between
 * different origins while the database still treats them as one site.
 */
export const normalizeSiteDomain = (input: string): string => {
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new ValidationError('请输入有效的公网 HTTPS 域名');
  }

  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new ValidationError('站点必须是单一公网 HTTPS 域名，不能包含端口、路径、参数或账号信息');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = hostname.split('.');
  if (
    hostname.length > 253
    || labels.length < 2
    || isIP(hostname) !== 0
    || hostname === 'localhost'
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || labels.some((label) => !PUBLIC_HOST_LABEL.test(label))
  ) {
    throw new ValidationError('站点必须使用可公开访问的 HTTPS 域名');
  }

  return hostname;
};
