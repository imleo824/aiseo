import { createHash } from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { ValidationError } from '../domain/errors';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';

const normalizeInputUrl = (value: string): string => /^https:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
const MAX_SOURCE_BYTES = 2_000_000;

const readBoundedText = async (response: Response): Promise<string> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) throw new ValidationError('来源页面超过 2MB 限制');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new ValidationError('来源页面超过 2MB 限制');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

export type CapturedSource = {
  normalizedUrl: string;
  title: string;
  content: string;
  checksum: string;
  fetchedAt: string;
};

export const capturePublicSource = async (input: string): Promise<CapturedSource> => {
  let url: URL;
  try { url = new URL(normalizeInputUrl(input)); } catch { throw new ValidationError('请输入有效的 HTTPS 站点或文章地址'); }
  const origin = await resolvePublicHttpsOrigin(url.toString());
  const normalizedUrl = `${origin}${url.pathname}${url.search}`;
  const response = await fetch(normalizedUrl, {
    redirect: 'manual',
    headers: { accept: 'text/html,text/plain' },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status >= 300 && response.status < 400) throw new ValidationError('来源 URL 不允许重定向，请提交最终 HTTPS 地址');
  if (!response.ok) throw new ValidationError(`来源页面抓取失败 (${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new ValidationError('来源必须是 HTML 或纯文本页面');
  const body = await readBoundedText(response);
  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url.hostname;
  const title = sanitizeHtml(titleMatch, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim().slice(0, 200) || url.hostname;
  const content = sanitizeHtml(body, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim().slice(0, 200_000);
  if (content.length < 100) throw new ValidationError('来源页面正文过短，无法形成可靠执行依据');
  return {
    normalizedUrl,
    title,
    content,
    checksum: createHash('sha256').update(content).digest('hex'),
    fetchedAt: new Date().toISOString()
  };
};
