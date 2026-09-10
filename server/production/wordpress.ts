import { ConflictError, ExternalServiceError, ValidationError } from '../domain/errors';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { createHash } from 'crypto';
import { decryptSecret, encryptSecret } from './crypto';
import sanitizeHtml from 'sanitize-html';

export type WordPressCredentials = { username: string; applicationPassword: string };

const authorization = (credentials: WordPressCredentials): string => {
  if (!credentials.username.trim() || !credentials.applicationPassword.trim()) {
    throw new ValidationError('必须提供 WordPress 用户名和应用密码');
  }
  const password = credentials.applicationPassword.replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${credentials.username.trim()}:${password}`).toString('base64')}`;
};

const requestJsonResponse = async <T>(url: string, init: RequestInit): Promise<{ body: T; headers: Headers }> => {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(12_000) });
  if (response.status >= 300 && response.status < 400) {
    throw new ExternalServiceError('WordPress REST API 不允许重定向，请绑定最终 HTTPS 域名');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new ExternalServiceError('WordPress REST API 返回了非 JSON 内容，可能被缓存、代理或安全插件拦截');
    body = {};
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : response.statusText;
    throw new ExternalServiceError(`WordPress 请求失败 (${response.status}): ${message}`);
  }
  return { body: body as T, headers: response.headers };
};

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => (await requestJsonResponse<T>(url, init)).body;

type WordPressEditableResource = {
  id?: number;
  link?: string;
  slug?: string;
  status?: string;
  modified_gmt?: string;
  type?: string;
  title?: { raw?: string; rendered?: string };
  excerpt?: { raw?: string; rendered?: string };
  content?: { raw?: string; rendered?: string };
  meta?: Record<string, unknown>;
  aioseo_meta_data?: Record<string, unknown>;
  yoast_head?: string;
  yoast_head_json?: Record<string, unknown>;
};

export const WORDPRESS_COMPATIBILITY_POLICY_VERSION = 'wordpress-compatibility-1';
export type WordPressEditorKind = 'CLASSIC' | 'GUTENBERG' | 'ELEMENTOR' | 'DIVI' | 'HEADLESS' | 'UNKNOWN';
export type WordPressCompatibilityMode = 'FULL_AUTO' | 'SAFE_AUTO' | 'ANALYSIS_ONLY' | 'BLOCKED';
export type WordPressGrowthAction = 'CREATE_CONTENT' | 'UPDATE_TITLE' | 'ADD_CONTENT_SECTION' | 'CONTENT_REFRESH' | 'ADD_INTERNAL_LINKS' | 'DIAGNOSE_ONLY';
export type WordPressActionCapability = {
  supported: boolean;
  reason: string;
  strategy?: 'CORE_FIELD' | 'AIOSEO_REST' | 'CLASSIC_DOM' | 'GUTENBERG_BLOCKS' | 'STANDARD_POST' | 'READ_ONLY';
  pageDependent?: boolean;
  resourceSupport?: Partial<Record<'posts' | 'pages', boolean>>;
};
export type WordPressActionCapabilities = Record<WordPressGrowthAction, WordPressActionCapability>;
export type WordPressCompatibilityScan = {
  restFingerprint: string;
  coreVersionEvidence: Record<string, unknown>;
  authenticationMode: 'APPLICATION_PASSWORD';
  routeSchemas: Record<string, unknown>;
  contentTypes: Record<string, unknown>;
  editorSignals: Record<string, unknown>;
  integrationSignals: Record<string, unknown>;
  actionCapabilities: WordPressActionCapabilities;
  mode: WordPressCompatibilityMode;
  blockReasons: string[];
  policyVersion: string;
  checkedAt: Date;
  expiresAt: Date;
};

export type WordPressSitePage = {
  wordpressId: string;
  resourceType: string;
  url: string;
  slug: string;
  status: string;
  modifiedAt?: string;
  title: string;
  excerpt: string;
  content: string;
  contentChecksum: string;
  wordCount: number;
  internalLinks: Array<{ url: string; anchor: string }>;
  seoMetadata: Record<string, unknown>;
  editorKind: WordPressEditorKind;
  structureChecksum: string;
  actionCapabilities: WordPressActionCapabilities;
};

export type WordPressSiteContext = {
  normalizedUrl: string;
  title: string;
  content: string;
  checksum: string;
  fetchedAt: string;
  internalLinks: Array<{ title: string; url: string }>;
  pages: WordPressSitePage[];
  site: { name: string; description: string; locale?: string; url: string };
  inventory: {
    resourceTypes: string[];
    unavailableResourceTypes?: string[];
    categories: number;
    tags: number;
    media: number;
    categoriesAvailable?: boolean;
    tagsAvailable?: boolean;
    mediaAvailable?: boolean;
  };
};

export type WordPressEditableSnapshot = {
  postId: string;
  resourceType: 'posts' | 'pages';
  url: string;
  status: string;
  modifiedAt?: string;
  slug: string;
  title: string;
  content: string;
  contentChecksum: string;
  contentLength: number;
  editorKind: WordPressEditorKind;
  structureChecksum: string;
  seoMetadata: Record<string, unknown>;
};

export type WordPressPublicVerification = {
  checkedAt: string;
  reachable: boolean;
  status: number;
  titleMatches?: boolean;
  deliveryMarkerVisible?: boolean;
  contentMatches?: boolean;
  linkMatches?: boolean;
  mutationMatches?: boolean;
};
export type WordPressMutationResult = {
  postId: string;
  url: string;
  snapshot: WordPressEditableSnapshot;
  changedFields: string[];
  verification: WordPressPublicVerification;
  remoteRevisionId?: string;
};

const plainText = (value: string): string => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
  return value;
};
const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

export const wordpressSiteEvidenceFingerprint = (input: {
  site: { name: string; description: string; locale?: string; url: string };
  inventory: WordPressSiteContext['inventory'];
  taxonomyContent: string;
  mediaContent: string;
  pages: WordPressSitePage[];
}): string => fingerprint({
  site: input.site,
  inventory: input.inventory,
  taxonomyContent: input.taxonomyContent,
  mediaContent: input.mediaContent,
  pages: [...input.pages]
    .sort((left, right) => left.url.localeCompare(right.url) || left.resourceType.localeCompare(right.resourceType))
    .map((page) => ({
      resourceType: page.resourceType,
      url: page.url,
      slug: page.slug,
      status: page.status,
      modifiedAt: page.modifiedAt || null,
      title: page.title,
      excerpt: page.excerpt,
      contentChecksum: page.contentChecksum,
      structureChecksum: page.structureChecksum,
      seoMetadata: page.seoMetadata,
      actionCapabilities: page.actionCapabilities
    }))
});

const blockTokens = (content: string): string[] => [...content.matchAll(/<!--\s*(\/?)wp:([a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)(?:\s+(\{[\s\S]*?\}))?\s*(\/?)-->/gi)]
  .map((match) => `${match[1] ? 'CLOSE' : match[4] ? 'SELF' : 'OPEN'}:${match[2].toLowerCase()}`);
const htmlTagTokens = (content: string): string[] => [...content.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi)]
  .map((match) => `${match[0].startsWith('</') ? '/' : ''}${match[1].toLowerCase()}`)
  .filter((tag) => !['script', '/script', 'style', '/style'].includes(tag));
const textShingleRetention = (beforeHtml: string, afterHtml: string): number => {
  const normalize = (value: string) => plainText(value).normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ');
  const before = normalize(beforeHtml);
  const after = normalize(afterHtml);
  if (!before) return 1;
  const width = Math.min(24, Math.max(8, Math.floor(before.length / 20)));
  const stride = Math.max(4, Math.floor(width / 2));
  const shingles = new Set<string>();
  for (let index = 0; index <= before.length - width; index += stride) shingles.add(before.slice(index, index + width));
  if (!shingles.size) return after.includes(before) ? 1 : 0;
  let retained = 0;
  for (const shingle of shingles) if (after.includes(shingle)) retained += 1;
  return retained / shingles.size;
};
const hasBuilderShortcodes = (content: string): boolean => /\[(?:et_pb_|vc_|fusion_|av_|fl_builder|elementor-template)/i.test(content);
const hasLockedBlocks = (content: string): boolean => /<!--\s*wp:[^>]+"(?:lock|templateLock)"\s*:/i.test(content);
const hasUnsafeBlocks = (content: string): boolean => blockTokens(content).some((token) => /:(?:core\/)?(?:block|query|query-loop|navigation|template-part|shortcode|latest-posts|latest-comments|rss|legacy-widget)$/.test(token));
const hasUnknownBlocks = (content: string): boolean => blockTokens(content).some((token) => !/:core\//.test(token) && !/:(?:paragraph|heading|list|quote|image|gallery|table|html|group|columns|column|buttons|button|separator|spacer|cover|media-text)$/.test(token));

export const detectWordPressEditor = (content: string, rendered = ''): WordPressEditorKind => {
  const combined = `${content}\n${rendered}`;
  if (/elementor|data-elementor-type|elementor-section|elementor-widget/i.test(combined)) return 'ELEMENTOR';
  if (/\[et_pb_|et_pb_(?:section|row|module)|et-builder/i.test(combined)) return 'DIVI';
  if (/<!--\s*wp:/i.test(content)) return 'GUTENBERG';
  if (hasBuilderShortcodes(content) || /(?:oxygen|bricks|beaver-builder|fl-builder|wpbakery)/i.test(combined)) return 'UNKNOWN';
  return content.trim() ? 'CLASSIC' : 'UNKNOWN';
};

export const wordpressStructureChecksum = (content: string, editorKind = detectWordPressEditor(content)): string => fingerprint({
  editorKind,
  blocks: blockTokens(content),
  tags: htmlTagTokens(content)
});

const pageActionCapabilities = (editorKind: WordPressEditorKind, content: string, resourceWritable = true): Pick<WordPressActionCapabilities, 'ADD_CONTENT_SECTION' | 'CONTENT_REFRESH' | 'ADD_INTERNAL_LINKS'> => {
  if (!resourceWritable) {
    const reason = '该内容类型没有经过 WordPress Core REST 写入契约验证，仅用于站点分析';
    return {
      ADD_CONTENT_SECTION: { supported: false, reason },
      CONTENT_REFRESH: { supported: false, reason },
      ADD_INTERNAL_LINKS: { supported: false, reason }
    };
  }
  if (editorKind === 'ELEMENTOR' || editorKind === 'DIVI' || editorKind === 'HEADLESS' || editorKind === 'UNKNOWN') {
    const reason = '页面由第三方或未知构建器控制，零插件模式禁止修改已有正文';
    return {
      ADD_CONTENT_SECTION: { supported: false, reason },
      CONTENT_REFRESH: { supported: false, reason },
      ADD_INTERNAL_LINKS: { supported: false, reason }
    };
  }
  if (editorKind === 'GUTENBERG' && (hasLockedBlocks(content) || hasUnsafeBlocks(content) || hasUnknownBlocks(content))) {
    const reason = '页面包含动态、复用、锁定或未知区块，无法证明结构可安全往返';
    return {
      ADD_CONTENT_SECTION: { supported: false, reason },
      CONTENT_REFRESH: { supported: false, reason },
      ADD_INTERNAL_LINKS: { supported: false, reason }
    };
  }
  const strategy = editorKind === 'GUTENBERG' ? 'GUTENBERG_BLOCKS' : 'CLASSIC_DOM';
  return {
    ADD_CONTENT_SECTION: { supported: true, reason: '页面结构可进行追加式局部修改', strategy },
    CONTENT_REFRESH: { supported: true, reason: '页面结构允许经过严格差异门禁的局部刷新', strategy },
    ADD_INTERNAL_LINKS: { supported: true, reason: '页面结构允许正文内局部链接修改', strategy }
  };
};

export const wordpressPageActionCapabilities = (editorKind: WordPressEditorKind, content: string, resourceWritable = true): WordPressActionCapabilities => ({
  CREATE_CONTENT: { supported: true, reason: '新内容使用独立标准文章，不触碰现有构建器页面', strategy: 'STANDARD_POST' },
  UPDATE_TITLE: resourceWritable
    ? { supported: true, reason: '最终写入策略由站点 SEO 集成能力档案决定', strategy: 'CORE_FIELD' }
    : { supported: false, reason: '该内容类型没有经过 WordPress Core REST 写入契约验证' },
  ...pageActionCapabilities(editorKind, content, resourceWritable),
  DIAGNOSE_ONLY: { supported: true, reason: '只读诊断始终可用', strategy: 'READ_ONLY' }
});

export const assertSafeWordPressMutation = (input: { actionType: WordPressGrowthAction; before: WordPressEditableSnapshot; afterTitle: string; afterContent: string }): string[] => {
  const { actionType, before, afterContent, afterTitle } = input;
  if (actionType === 'UPDATE_TITLE') {
    if (afterContent !== before.content) throw new ValidationError('标题动作不得修改 WordPress 正文');
    if (!afterTitle.trim() || afterTitle === before.title) throw new ValidationError('标题动作没有产生可验证的字段变化');
    return ['title'];
  }
  const capability = pageActionCapabilities(before.editorKind, before.content)[actionType as 'ADD_CONTENT_SECTION' | 'CONTENT_REFRESH' | 'ADD_INTERNAL_LINKS'];
  if (!capability?.supported) throw new ValidationError(capability?.reason || '当前页面结构不支持该正文动作');
  if (afterTitle !== before.title) throw new ValidationError('正文动作不得同时修改标题');
  if (afterContent === before.content) throw new ValidationError('WordPress 正文动作没有产生实际变化');
  if (actionType === 'ADD_CONTENT_SECTION' && !afterContent.startsWith(before.content)) {
    throw new ValidationError('新增内容动作必须完整保留原正文并仅在末尾追加');
  }
  if (actionType === 'ADD_INTERNAL_LINKS' && plainText(afterContent) !== plainText(before.content)) {
    throw new ValidationError('内链动作改变了页面可见文字，已停止写入');
  }
  if (actionType === 'ADD_INTERNAL_LINKS') {
    const addedHref = addedLinkHref(before.content, afterContent);
    if (!addedHref) throw new ValidationError('内链动作没有新增可验证的链接，已停止写入');
    let internal = false;
    try {
      const target = new URL(addedHref, before.url);
      internal = target.protocol === 'https:' && target.origin === new URL(before.url).origin;
    } catch {
      internal = false;
    }
    if (!internal) {
      throw new ValidationError('内链动作包含站外或非 HTTPS 链接，已停止写入');
    }
  }
  if (actionType === 'CONTENT_REFRESH' && textShingleRetention(before.content, afterContent) < 0.65) {
    throw new ValidationError('内容刷新不是局部差异，已阻止整体覆盖客户正文');
  }
  if (before.editorKind === 'GUTENBERG') {
    const beforeTokens = blockTokens(before.content);
    const afterTokens = blockTokens(afterContent);
    const preserved = actionType === 'ADD_CONTENT_SECTION'
      ? beforeTokens.every((token, index) => afterTokens[index] === token)
      : beforeTokens.length === afterTokens.length && beforeTokens.every((token, index) => afterTokens[index] === token);
    if (!preserved || hasLockedBlocks(afterContent) || hasUnsafeBlocks(afterContent) || hasUnknownBlocks(afterContent)) {
      throw new ValidationError('Gutenberg 区块结构未通过无损往返验证');
    }
  } else {
    const beforeTags = htmlTagTokens(before.content);
    const afterTags = htmlTagTokens(afterContent);
    if (actionType !== 'ADD_CONTENT_SECTION') {
      const tagDistance = Math.abs(afterTags.length - beforeTags.length) / Math.max(1, beforeTags.length);
      if (tagDistance > 0.2) throw new ValidationError('Classic HTML 结构变化超出局部修改安全阈值');
    }
  }
  return ['content'];
};

const wordCount = (value: string): number => {
  const text = plainText(value);
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return han + words;
};

const comparableUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};
const isSameOriginHttpsUrl = (value: string, origin: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
};

const snapshotFromResource = (resource: WordPressEditableResource, resourceType: 'posts' | 'pages', fallbackSlug = ''): WordPressEditableSnapshot => {
  if (!resource.id || !resource.link) throw new ExternalServiceError('WordPress 内容响应缺少 ID 或链接');
  const title = String(resource.title?.raw || resource.title?.rendered || '').trim();
  const content = String(resource.content?.raw || resource.content?.rendered || '');
  const editorKind = detectWordPressEditor(content, String(resource.content?.rendered || ''));
  return {
    postId: String(resource.id),
    resourceType,
    url: resource.link,
    status: String(resource.status || 'unknown'),
    modifiedAt: resource.modified_gmt,
    slug: String(resource.slug || fallbackSlug),
    title,
    content,
    contentChecksum: createHash('sha256').update(content).digest('hex'),
    contentLength: Buffer.byteLength(content, 'utf8'),
    editorKind,
    structureChecksum: wordpressStructureChecksum(content, editorKind),
    seoMetadata: {
      aioseoMetaData: resource.aioseo_meta_data || null,
      yoastHead: resource.yoast_head || null,
      yoastHeadJson: resource.yoast_head_json || null
    }
  };
};

const internalLinksFromHtml = (html: string, origin: string): Array<{ url: string; anchor: string }> => {
  const links = new Map<string, { url: string; anchor: string }>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.protocol !== 'https:' || url.origin !== origin) continue;
      const normalized = comparableUrl(url.toString());
      if (!links.has(normalized)) links.set(normalized, { url: normalized, anchor: plainText(match[2]).slice(0, 200) });
    } catch {
      // Invalid anchors are ignored but remain visible to the OnPage audit.
    }
  }
  return [...links.values()];
};

const MAX_WORDPRESS_RESOURCES = 10_000;
const MAX_WORDPRESS_RESOURCE_TYPES = 20;
const MAX_PAGE_CONTENT_BYTES = 1_000_000;
const MAX_SITE_CONTENT_BYTES = 100_000_000;
const PROFILE_TTL_MS = 24 * 60 * 60_000;
const assertDeliveryId = (deliveryId: string): void => {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new ValidationError('WordPress 交付幂等标识无效');
};
const deliveryMarker = (deliveryId: string): string => `<!-- aiseo-delivery:${deliveryId} -->`;

const readAllResources = async <T>(url: URL, headers: Record<string, string>): Promise<T[]> => {
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', '1');
  const first = await requestJsonResponse<T[]>(url.toString(), { headers });
  if (!Array.isArray(first.body)) throw new ExternalServiceError('WordPress 列表接口返回了无效结构');
  const totalPages = Math.max(1, Number(first.headers.get('x-wp-totalpages') || 1));
  const total = Number(first.headers.get('x-wp-total') || first.body.length);
  if (!Number.isInteger(totalPages) || totalPages > Math.ceil(MAX_WORDPRESS_RESOURCES / 100)
    || !Number.isInteger(total) || total < 0 || total > MAX_WORDPRESS_RESOURCES) {
    throw new ValidationError(`WordPress 内容超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限，请先缩小公开内容范围`);
  }
  const result = [...first.body];
  for (let page = 2; page <= totalPages; page += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4, totalPages - page + 1) }, (_, offset) => {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('page', String(page + offset));
      return requestJson<unknown>(pageUrl.toString(), { headers }).then((items) => {
        if (!Array.isArray(items)) throw new ExternalServiceError('WordPress 分页列表返回了无效结构');
        return items as T[];
      });
    }));
    for (const items of batch) result.push(...items);
    if (result.length > MAX_WORDPRESS_RESOURCES) throw new ValidationError(`WordPress 内容超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限`);
  }
  return result;
};

const readOptionalResources = async <T>(url: URL, headers: Record<string, string>): Promise<{ items: T[]; available: boolean }> => {
  try {
    return { items: await readAllResources<T>(url, headers), available: true };
  } catch {
    return { items: [], available: false };
  }
};

type RestRoute = { methods?: string[]; endpoints?: Array<{ methods?: string[]; args?: Record<string, unknown> }> };
type RestRoot = {
  name?: string;
  url?: string;
  home?: string;
  namespaces?: string[];
  routes?: Record<string, RestRoute>;
  authentication?: Record<string, unknown>;
};

const compactRoute = (route: RestRoute | undefined): Record<string, unknown> => ({
  methods: [...new Set([...(route?.methods || []), ...(route?.endpoints || []).flatMap((endpoint) => endpoint.methods || [])])].sort(),
  writableFields: [...new Set((route?.endpoints || []).flatMap((endpoint) => Object.keys(endpoint.args || {})))].sort()
});
const routeSupports = (route: RestRoute | undefined, method: string): boolean => {
  const methods = [...(route?.methods || []), ...(route?.endpoints || []).flatMap((endpoint) => endpoint.methods || [])].map((value) => value.toUpperCase());
  return methods.includes(method.toUpperCase());
};
const routeFieldWritable = (route: RestRoute | undefined, field: string): boolean => (route?.endpoints || [])
  .some((endpoint) => (endpoint.methods || []).some((method) => ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) && field in (endpoint.args || {}));
const itemRoute = (routes: Record<string, RestRoute> | undefined, resourceType: string): RestRoute | undefined => Object.entries(routes || {})
  .find(([path]) => path.startsWith(`/wp/v2/${resourceType}/(?P<id>`))?.[1];
const publicHeadEvidence = (html: string): { title: string | null; canonical: string | null; generators: string[] } => {
  const title = plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || null;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1]
    || null;
  const generators = [...html.matchAll(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/gi)].map((match) => match[1].slice(0, 200));
  return { title, canonical, generators };
};

const normalizedVisibleText = (html: string): string => plainText(html).normalize('NFKC').toLocaleLowerCase();
const changedTextFragment = (beforeContent: string | undefined, afterContent: string | undefined): string | undefined => {
  const before = normalizedVisibleText(beforeContent || '');
  const after = normalizedVisibleText(afterContent || '');
  if (!after) return undefined;
  const candidates = after.split(/(?<=[。！？.!?])\s*|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 16)
    .sort((left, right) => right.length - left.length);
  const unique = candidates.find((part) => !before.includes(part.slice(0, Math.min(80, part.length))));
  return (unique || (!before.includes(after.slice(-80)) ? after.slice(-80) : '')).slice(0, 120) || undefined;
};
const addedLinkHref = (beforeContent: string | undefined, afterContent: string | undefined): string | undefined => {
  const before = new Set([...(beforeContent || '').matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((match) => match[1]));
  return [...(afterContent || '').matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .find((href) => !before.has(href));
};

const verifyPublicMutation = async (input: {
  url: string;
  actionType?: WordPressGrowthAction;
  expectedTitle?: string;
  deliveryId?: string;
  beforeContent?: string;
  afterContent?: string;
}): Promise<WordPressPublicVerification> => {
  const checkedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetch(input.url, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } });
  } catch {
    return { checkedAt, reachable: false, status: 0, mutationMatches: false };
  }
  const verification: WordPressPublicVerification = { checkedAt, reachable: response.ok, status: response.status };
  if (!response.ok) return { ...verification, mutationMatches: false };
  const html = await response.text();
  if (input.expectedTitle) verification.titleMatches = publicHeadEvidence(html).title?.toLocaleLowerCase().includes(input.expectedTitle.trim().toLocaleLowerCase()) === true;
  if (input.deliveryId) verification.deliveryMarkerVisible = html.includes(deliveryMarker(input.deliveryId));
  if (input.actionType === 'ADD_INTERNAL_LINKS') {
    const href = addedLinkHref(input.beforeContent, input.afterContent);
    try {
      const expected = href ? comparableUrl(new URL(href, input.url).toString()) : null;
      verification.linkMatches = Boolean(expected && [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
        .some((match) => comparableUrl(new URL(match[1], input.url).toString()) === expected));
    } catch {
      verification.linkMatches = false;
    }
  } else if (input.afterContent && input.actionType !== 'UPDATE_TITLE') {
    const fragment = changedTextFragment(input.beforeContent, input.afterContent);
    verification.contentMatches = Boolean(fragment && normalizedVisibleText(html).includes(fragment));
  }
  const bodyEvidence = input.actionType === 'ADD_INTERNAL_LINKS'
    ? verification.linkMatches
    : input.afterContent && input.actionType !== 'UPDATE_TITLE'
      ? verification.contentMatches || verification.deliveryMarkerVisible
      : input.deliveryId
        ? verification.deliveryMarkerVisible
        : true;
  verification.mutationMatches = verification.titleMatches !== false && bodyEvidence !== false;
  return verification;
};

const latestRevisionId = async (origin: string, resourceType: 'posts' | 'pages', postId: string, headers: Record<string, string>): Promise<string | undefined> => {
  try {
    const revisions = await requestJson<Array<{ id?: number }>>(`${origin}/wp-json/wp/v2/${resourceType}/${postId}/revisions?context=edit&per_page=1&_fields=id`, { headers });
    return revisions[0]?.id ? String(revisions[0].id) : undefined;
  } catch {
    return undefined;
  }
};

const seoSignals = (input: {
  namespaces: string[];
  sample: WordPressEditableResource | undefined;
  homepageHtml: string;
  postRoute?: RestRoute;
  pageRoute?: RestRoute;
}): Record<string, unknown> => {
  const namespaceText = input.namespaces.join(' ').toLowerCase();
  const source = `${input.homepageHtml}\n${JSON.stringify(input.sample || {})}`.toLowerCase();
  const aioseo = namespaceText.includes('aioseo') || /aioseo/.test(source) || Boolean(input.sample?.aioseo_meta_data);
  const yoast = namespaceText.includes('yoast') || /yoast/.test(source) || Boolean(input.sample?.yoast_head || input.sample?.yoast_head_json);
  const rankMath = /rank[-_ ]?math/.test(namespaceText) || /rank[-_ ]?math/.test(source);
  const detected = [aioseo && 'AIOSEO', yoast && 'YOAST', rankMath && 'RANK_MATH'].filter(Boolean) as string[];
  return {
    detected,
    conflict: detected.length > 1,
    aioseo: {
      detected: aioseo,
      writablePublicRestField: aioseo && (routeFieldWritable(input.postRoute, 'aioseo_meta_data') || routeFieldWritable(input.pageRoute, 'aioseo_meta_data')),
      resourceSupport: {
        posts: aioseo && routeFieldWritable(input.postRoute, 'aioseo_meta_data'),
        pages: aioseo && routeFieldWritable(input.pageRoute, 'aioseo_meta_data')
      }
    },
    yoast: { detected: yoast, access: 'READ_ONLY' },
    rankMath: { detected: rankMath, access: 'READ_ONLY_WITHOUT_PUBLIC_WRITE_CONTRACT' },
    source: 'REST_NAMESPACES_FIELDS_AND_PUBLIC_HTML'
  };
};

const capability = (supported: boolean, reason: string, extra: Partial<WordPressActionCapability> = {}): WordPressActionCapability => ({ supported, reason, ...extra });

export const wordpressCompatibilityAllows = (
  scan: Pick<WordPressCompatibilityScan, 'mode' | 'actionCapabilities'>,
  action: WordPressGrowthAction,
  page?: { resourceType: string; editorKind: WordPressEditorKind; content: string }
): { supported: boolean; reason: string } => {
  const siteCapability = scan.actionCapabilities[action];
  if (!siteCapability?.supported) return { supported: false, reason: siteCapability?.reason || '站点兼容档案未授权此动作' };
  if (page && action !== 'CREATE_CONTENT' && action !== 'DIAGNOSE_ONLY') {
    if (page.resourceType !== 'posts' && page.resourceType !== 'pages') {
      return { supported: false, reason: '该自定义内容类型没有经过 WordPress Core REST 写入契约验证' };
    }
    if (siteCapability.resourceSupport?.[page.resourceType] === false) {
      return { supported: false, reason: `${page.resourceType} REST 路由未通过该动作的写入能力验证` };
    }
  }
  if (page && ['ADD_CONTENT_SECTION', 'CONTENT_REFRESH', 'ADD_INTERNAL_LINKS'].includes(action)) {
    const pageCapability = pageActionCapabilities(page.editorKind, page.content)[action as 'ADD_CONTENT_SECTION' | 'CONTENT_REFRESH' | 'ADD_INTERNAL_LINKS'];
    if (!pageCapability.supported) return pageCapability;
  }
  return { supported: true, reason: siteCapability.reason };
};

export const blockedWordPressCompatibility = (error: unknown): WordPressCompatibilityScan => {
  const message = error instanceof Error ? error.message : 'WordPress HTTPS、认证或 REST API 不可用';
  const checkedAt = new Date();
  const blocked = capability(false, message);
  return {
    restFingerprint: fingerprint({ blocked: message, policy: WORDPRESS_COMPATIBILITY_POLICY_VERSION }),
    coreVersionEvidence: { available: false },
    authenticationMode: 'APPLICATION_PASSWORD',
    routeSchemas: {},
    contentTypes: {},
    editorSignals: {},
    integrationSignals: {},
    actionCapabilities: {
      CREATE_CONTENT: blocked,
      UPDATE_TITLE: blocked,
      ADD_CONTENT_SECTION: blocked,
      CONTENT_REFRESH: blocked,
      ADD_INTERNAL_LINKS: blocked,
      DIAGNOSE_ONLY: capability(true, '兼容检查失败时只允许返回诊断，不执行写入', { strategy: 'READ_ONLY' })
    },
    mode: 'BLOCKED',
    blockReasons: [message],
    policyVersion: WORDPRESS_COMPATIBILITY_POLICY_VERSION,
    checkedAt,
    expiresAt: new Date(checkedAt.getTime() + PROFILE_TTL_MS)
  };
};

export const wordPressService = {
  encrypt(credentials: WordPressCredentials): Buffer {
    authorization(credentials);
    return encryptSecret(credentials);
  },

  decrypt(encrypted: Uint8Array): WordPressCredentials {
    return decryptSecret<WordPressCredentials>(Buffer.from(encrypted));
  },

  async verifyPublic(input: {
    domain: string;
    url: string;
    actionType?: WordPressGrowthAction;
    expectedTitle?: string;
    deliveryId?: string;
    beforeContent?: string;
    afterContent?: string;
  }): Promise<WordPressPublicVerification> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const target = new URL(input.url);
    if (target.protocol !== 'https:' || target.origin !== origin) throw new ValidationError('公开页面验证 URL 与已绑定 WordPress 站点不一致');
    return verifyPublicMutation({
      url: target.toString(),
      actionType: input.actionType,
      expectedTitle: input.expectedTitle,
      deliveryId: input.deliveryId,
      beforeContent: input.beforeContent,
      afterContent: input.afterContent
    });
  },

  async applicationPasswordAuthorizationUrl(domain: string): Promise<string> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const root = await requestJson<{ authentication?: { 'application-passwords'?: { endpoints?: { authorization?: string } } } }>(`${origin}/wp-json`, { headers: { accept: 'application/json' } });
    const endpoint = root.authentication?.['application-passwords']?.endpoints?.authorization;
    if (!endpoint) throw new ValidationError('该 WordPress 站点未公开 Application Password 授权入口，请确认 WordPress 版本和 HTTPS 配置');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new ValidationError('WordPress 返回了不安全或跨站的授权地址');
    return url.toString();
  },

  async inspectSiteHealth(domain: string): Promise<{
    origin: string;
    homepageStatus: number;
    canonical: string | null;
    robots: { status: number; available: boolean; blocksAll: boolean };
    sitemap: { url: string | null; status: number | null; available: boolean };
    restApi: boolean;
  }> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const [homepage, robots, rest] = await Promise.all([
      fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } }),
      fetch(`${origin}/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/plain' } }),
      fetch(`${origin}/wp-json`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } })
    ]);
    if (!homepage.ok) throw new ValidationError(`网站首页不可访问 (${homepage.status})`);
    if (!rest.ok) throw new ValidationError(`WordPress REST API 不可访问 (${rest.status})`);
    const [html, robotsText] = await Promise.all([homepage.text(), robots.ok ? robots.text() : Promise.resolve('')]);
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    let sitemapUrl: string | null = null;
    let sitemapStatus: number | null = null;
    for (const path of ['/wp-sitemap.xml', '/sitemap.xml']) {
      const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/xml,text/xml' } });
      if (response.ok) {
        sitemapUrl = `${origin}${path}`;
        sitemapStatus = response.status;
        break;
      }
      sitemapStatus = response.status;
    }
    return {
      origin,
      homepageStatus: homepage.status,
      canonical: canonicalMatch?.[1] || null,
      robots: {
        status: robots.status,
        available: robots.ok,
        blocksAll: /(?:^|\n)\s*user-agent\s*:\s*\*\s*(?:\r?\n)+(?:[^\n]*\n)*?\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(robotsText)
      },
      sitemap: { url: sitemapUrl, status: sitemapStatus, available: Boolean(sitemapUrl) },
      restApi: rest.ok
    };
  },

  async scanCompatibility(domain: string, encrypted: Uint8Array): Promise<WordPressCompatibilityScan> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, currentUser, types, homepageResponse] = await Promise.all([
      requestJson<RestRoot>(`${origin}/wp-json`, { headers }),
      requestJson<{ id?: number; name?: string; slug?: string; capabilities?: Record<string, boolean> }>(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers }),
      requestJson<Record<string, { rest_base?: string; viewable?: boolean }>>(`${origin}/wp-json/wp/v2/types?context=edit`, { headers }).catch(() => ({})),
      fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } })
    ]);
    if (!Number.isInteger(currentUser.id) || Number(currentUser.id) <= 0) {
      throw new ExternalServiceError('WordPress 当前用户身份响应无效，Application Password 可能被代理或安全插件拦截');
    }
    if (!homepageResponse.ok || (homepageResponse.status >= 300 && homepageResponse.status < 400)) {
      throw new ValidationError(`WordPress 首页不可用于兼容验证 (${homepageResponse.status})`);
    }
    const homepageHtml = await homepageResponse.text();
    const routeKeys = ['/wp/v2/posts', '/wp/v2/pages', '/wp/v2/types', '/wp/v2/media'] as const;
    const optionResults = await Promise.all(routeKeys.map(async (route) => {
      try {
        const body = await requestJson<Record<string, unknown>>(`${origin}/wp-json${route}`, { method: 'OPTIONS', headers });
        return [route, { available: true, fingerprint: fingerprint(body) }] as const;
      } catch (error) {
        return [route, { available: false, error: error instanceof Error ? error.message.slice(0, 300) : 'OPTIONS unavailable' }] as const;
      }
    }));
    const postsRoute = root.routes?.['/wp/v2/posts'];
    const pagesRoute = root.routes?.['/wp/v2/pages'];
    const postsItemRoute = itemRoute(root.routes, 'posts');
    const pagesItemRoute = itemRoute(root.routes, 'pages');
    const [posts, pages] = await Promise.all([
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?context=edit&status=any&per_page=10&_fields=id,link,slug,status,modified_gmt,title,content,aioseo_meta_data,yoast_head,yoast_head_json`, { headers }).catch(() => []),
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/pages?context=edit&status=any&per_page=10&_fields=id,link,slug,status,modified_gmt,title,content,aioseo_meta_data,yoast_head,yoast_head_json`, { headers }).catch(() => [])
    ]);
    const samples = {
      posts: posts.find((item) => item.link && (item.content?.raw || item.content?.rendered)),
      pages: pages.find((item) => item.link && (item.content?.raw || item.content?.rendered))
    };
    const samplePublicHtml = Object.fromEntries(await Promise.all((['posts', 'pages'] as const).map(async (resourceType) => {
      const selected = samples[resourceType];
      if (!selected?.link || !isSameOriginHttpsUrl(selected.link, origin)) return [resourceType, ''] as const;
      try {
        const response = await fetch(selected.link, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } });
        return [resourceType, response.ok ? await response.text() : ''] as const;
      } catch {
        return [resourceType, ''] as const;
      }
    }))) as Record<'posts' | 'pages', string>;
    const sample = samples.posts || samples.pages;
    const namespaces = Array.isArray(root.namespaces) ? root.namespaces.map(String) : [];
    const integrations = seoSignals({
      namespaces,
      sample,
      homepageHtml: `${homepageHtml}\n${samplePublicHtml.posts}\n${samplePublicHtml.pages}`,
      postRoute: postsItemRoute,
      pageRoute: pagesItemRoute
    });
    const editorKinds = [...posts, ...pages].map((item) => detectWordPressEditor(String(item.content?.raw || ''), String(item.content?.rendered || '')));
    const editorCounts = editorKinds.reduce<Record<string, number>>((counts, kind) => ({ ...counts, [kind]: (counts[kind] || 0) + 1 }), {});
    const sampledPageCapabilities = (['posts', 'pages'] as const).flatMap((resourceType) => {
      const selected = samples[resourceType];
      if (!selected) return [];
      const content = String(selected.content?.raw || '');
      const editor = detectWordPressEditor(content, String(selected.content?.rendered || ''));
      return [pageActionCapabilities(editor, content, resourceType === 'posts' ? routeSupports(postsItemRoute, 'POST') : routeSupports(pagesItemRoute, 'POST'))];
    });
    const head = publicHeadEvidence(`${homepageHtml}\n${samplePublicHtml.posts}\n${samplePublicHtml.pages}`);
    const detectedSeoPlugins = Array.isArray(integrations.detected) ? integrations.detected as string[] : [];
    const seoConflict = integrations.conflict === true;
    const aioseoResourceSupport = (integrations.aioseo as {
      resourceSupport?: Partial<Record<'posts' | 'pages', boolean>>;
    }).resourceSupport || {};
    const coreTitleSupport = Object.fromEntries((['posts', 'pages'] as const).map((resourceType) => {
      const sampleTitle = plainText(String(samples[resourceType]?.title?.raw || samples[resourceType]?.title?.rendered || ''));
      const publicTitle = publicHeadEvidence(samplePublicHtml[resourceType]).title;
      return [resourceType, Boolean(sampleTitle && publicTitle?.toLocaleLowerCase().includes(sampleTitle.toLocaleLowerCase()))];
    })) as Record<'posts' | 'pages', boolean>;
    const canEditPosts = currentUser.capabilities?.edit_posts === true;
    const canEditPages = currentUser.capabilities?.edit_pages === true;
    const canEditPublishedPosts = canEditPosts && currentUser.capabilities?.edit_published_posts === true;
    const canEditPublishedPages = canEditPages && currentUser.capabilities?.edit_published_pages === true;
    const canPublishPosts = currentUser.capabilities?.publish_posts === true;
    const canTrashPublishedPosts = currentUser.capabilities?.delete_posts === true
      && currentUser.capabilities?.delete_published_posts === true;
    const canCreate = canEditPosts
      && canPublishPosts
      && canTrashPublishedPosts
      && routeSupports(postsRoute, 'POST')
      && routeSupports(postsItemRoute, 'POST')
      && routeSupports(postsItemRoute, 'DELETE');
    const resourceUpdateSupport = {
      posts: canEditPublishedPosts && routeSupports(postsItemRoute, 'POST'),
      pages: canEditPublishedPages && routeSupports(pagesItemRoute, 'POST')
    };
    const aioseoSafeResourceSupport = {
      posts: resourceUpdateSupport.posts && aioseoResourceSupport.posts === true,
      pages: resourceUpdateSupport.pages && aioseoResourceSupport.pages === true
    };
    const coreTitleSafeResourceSupport = {
      posts: resourceUpdateSupport.posts && coreTitleSupport.posts,
      pages: resourceUpdateSupport.pages && coreTitleSupport.pages
    };
    const canUpdate = resourceUpdateSupport.posts || resourceUpdateSupport.pages;
    let headless = false;
    try {
      headless = Boolean(root.home && new URL(String(root.home), origin).origin !== origin);
    } catch {
      headless = true;
    }
    let titleCapability: WordPressActionCapability;
    if (!canUpdate) titleCapability = capability(false, '当前 WordPress 用户或 REST 路由不允许更新内容');
    else if (seoConflict) titleCapability = capability(false, '多个 SEO 插件同时输出元数据，无法唯一验证搜索标题控制方');
    else if (detectedSeoPlugins.includes('AIOSEO')) titleCapability = Object.values(aioseoSafeResourceSupport).some(Boolean)
      ? capability(true, 'AIOSEO 提供经过 REST schema 与用户权限验证的公开可写字段', { strategy: 'AIOSEO_REST', pageDependent: true, resourceSupport: aioseoSafeResourceSupport })
      : capability(false, '检测到 AIOSEO，但公开 REST schema 未声明可写 aioseo_meta_data');
    else if (detectedSeoPlugins.includes('YOAST')) titleCapability = capability(false, 'Yoast 官方 REST 接口只读，零插件模式不写私有字段');
    else if (detectedSeoPlugins.includes('RANK_MATH')) titleCapability = capability(false, 'Rank Math 未提供已验证的公开稳定写入契约');
    else titleCapability = Object.values(coreTitleSafeResourceSupport).some(Boolean)
      ? capability(true, '公开页面与用户权限验证表明 Core title 可安全控制搜索标题', { strategy: 'CORE_FIELD', pageDependent: true, resourceSupport: coreTitleSafeResourceSupport })
      : capability(false, '尚未通过公开页面证明 Core title 能控制最终搜索标题');
    if (headless) titleCapability = capability(false, 'REST API 与公开站点属于不同来源，Headless 模式下无法安全验证标题写入');
    const hasSafeBodySample = sampledPageCapabilities.length
      ? sampledPageCapabilities.some((capabilities) => Object.values(capabilities).some(({ supported }) => supported))
      : canUpdate;
    const bodyReason = headless
      ? 'REST API 与公开站点属于不同来源，Headless 模式下禁止自动修改现有正文'
      : canUpdate && hasSafeBodySample
      ? '已有内容按页面编辑器类型执行局部结构门禁'
      : '没有发现可证明安全的现有正文写入路径';
    const actionCapabilities: WordPressActionCapabilities = {
      CREATE_CONTENT: capability(!headless && canCreate, headless ? 'Headless 站点的公开渲染不受当前 REST 写入结果直接控制' : canCreate ? '可通过标准 posts REST 路由创建、发布、回读并移入回收站' : '缺少标准文章创建、发布或安全回滚权限', { strategy: 'STANDARD_POST' }),
      UPDATE_TITLE: titleCapability,
      ADD_CONTENT_SECTION: capability(!headless && canUpdate && hasSafeBodySample, bodyReason, { pageDependent: true, resourceSupport: resourceUpdateSupport }),
      CONTENT_REFRESH: capability(!headless && canUpdate && hasSafeBodySample, bodyReason, { pageDependent: true, resourceSupport: resourceUpdateSupport }),
      ADD_INTERNAL_LINKS: capability(!headless && canUpdate && hasSafeBodySample, bodyReason, { pageDependent: true, resourceSupport: resourceUpdateSupport }),
      DIAGNOSE_ONLY: capability(true, 'REST 读取与身份验证通过，只读诊断可用', { strategy: 'READ_ONLY' })
    };
    const mutating = (Object.entries(actionCapabilities) as Array<[WordPressGrowthAction, WordPressActionCapability]>)
      .filter(([action]) => action !== 'DIAGNOSE_ONLY');
    const supportedMutations = mutating.filter(([, item]) => item.supported).length;
    const hasPageSpecificLimit = sampledPageCapabilities.some((capabilities) =>
      Object.values(capabilities).some(({ supported }) => !supported));
    const hasPartialResourceSupport = mutating.some(([, item]) => item.supported
      && item.resourceSupport
      && Object.values(item.resourceSupport).some((supported) => supported === false));
    const mode: WordPressCompatibilityMode = supportedMutations === mutating.length && !hasPartialResourceSupport && !hasPageSpecificLimit
      ? 'FULL_AUTO'
      : supportedMutations > 0 ? 'SAFE_AUTO' : 'ANALYSIS_ONLY';
    const blockReasons = [
      ...mutating.filter(([, item]) => !item.supported).map(([action, item]) => `${action}: ${item.reason}`),
      ...(hasPageSpecificLimit ? ['部分页面包含构建器、动态区块或未知结构，系统将按页面自动跳过不安全动作'] : [])
    ];
    const routeSchemas = {
      routes: {
        ...Object.fromEntries(routeKeys.map((route) => [route, compactRoute(root.routes?.[route])])),
        '/wp/v2/posts/<id>': compactRoute(postsItemRoute),
        '/wp/v2/pages/<id>': compactRoute(pagesItemRoute)
      },
      options: Object.fromEntries(optionResults)
    };
    const contentTypes = Object.fromEntries(Object.entries(types).map(([name, type]) => {
      const restBase = type.rest_base || '';
      const collection = restBase ? root.routes?.[`/wp/v2/${restBase}`] : undefined;
      const item = restBase ? itemRoute(root.routes, restBase) : undefined;
      const excludedFromMutation = /^(?:product|products|shop_order|orders|shop_coupon|shop_subscription)$/i.test(name)
        || /^(?:products|orders)$/i.test(restBase);
      return [name, {
        restBase: restBase || null,
        viewable: type.viewable !== false,
        excludedFromMutation,
        capabilities: {
          read: routeSupports(collection, 'GET'),
          create: !excludedFromMutation && routeSupports(collection, 'POST'),
          update: !excludedFromMutation && routeSupports(item, 'POST'),
          delete: !excludedFromMutation && routeSupports(item, 'DELETE')
        }
      }];
    }));
    const coreGenerator = head.generators.find((value) => /^wordpress\s/i.test(value));
    const checkedAt = new Date();
    const profileEvidence = {
      namespaces: [...namespaces].sort(),
      routeSchemas,
      contentTypes,
      editorCounts,
      integrations,
      capabilities: currentUser.capabilities || {}
    };
    return {
      restFingerprint: fingerprint(profileEvidence),
      coreVersionEvidence: coreGenerator ? { source: 'PUBLIC_META_GENERATOR', value: coreGenerator } : { source: 'REST_CAPABILITY_PROBE', value: 'NOT_DISCLOSED' },
      authenticationMode: 'APPLICATION_PASSWORD',
      routeSchemas,
      contentTypes,
      editorSignals: { counts: editorCounts, sampledResources: posts.length + pages.length, headless },
      integrationSignals: integrations,
      actionCapabilities,
      mode,
      blockReasons,
      policyVersion: WORDPRESS_COMPATIBILITY_POLICY_VERSION,
      checkedAt,
      expiresAt: new Date(checkedAt.getTime() + PROFILE_TTL_MS)
    };
  },

  async testConnection(domain: string, encrypted: Uint8Array): Promise<{ user: string; siteName: string; capabilities: Record<string, boolean> }> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, currentUser] = await Promise.all([
      requestJson<Record<string, unknown>>(`${origin}/wp-json`, { headers }),
      requestJson<{ id?: number; name?: string; slug?: string; capabilities?: Record<string, boolean> }>(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers })
    ]);
    if (!Number.isInteger(currentUser.id) || Number(currentUser.id) <= 0 || (!currentUser.name && !currentUser.slug)) {
      throw new ExternalServiceError('WordPress 当前用户身份响应无效');
    }
    return {
      user: String(currentUser.name || currentUser.slug || credentials.username),
      siteName: String(root.name || domain),
      capabilities: currentUser.capabilities || {}
    };
  },

  async inspectTarget(input: { domain: string; encrypted: Uint8Array; targetUrl: string; resourceType?: 'posts' | 'pages' }): Promise<WordPressEditableSnapshot> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const target = new URL(input.targetUrl);
    if (target.protocol !== 'https:' || target.origin !== origin) throw new ValidationError('增长动作目标必须是已验证 WordPress 站点内的 HTTPS URL');
    const slug = decodeURIComponent(target.pathname.split('/').filter(Boolean).at(-1) || '');
    if (!slug) throw new ValidationError('首页或无 slug 页面不能通过自动执行器修改');
    const credentials = this.decrypt(input.encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const fields = '_fields=id,link,slug,status,modified_gmt,title,content,aioseo_meta_data,yoast_head,yoast_head_json';
    const [posts, pages] = await Promise.all([
      input.resourceType === 'pages' ? Promise.resolve([]) : requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers }),
      input.resourceType === 'posts' ? Promise.resolve([]) : requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers })
    ]);
    const candidates = [
      ...posts.map((resource) => ({ resource, resourceType: 'posts' as const })),
      ...pages.map((resource) => ({ resource, resourceType: 'pages' as const }))
    ];
    const matched = candidates.find(({ resource }) => resource.link && comparableUrl(resource.link) === comparableUrl(input.targetUrl));
    if (!matched?.resource.id || !matched.resource.link) throw new ValidationError('WordPress REST API 中未找到与目标 URL 精确匹配的可编辑内容');
    return snapshotFromResource(matched.resource, matched.resourceType, slug);
  },

  async readResourceById(input: { domain: string; encrypted: Uint8Array; postId: string; resourceType: 'posts' | 'pages' }): Promise<WordPressEditableSnapshot> {
    if (!/^\d+$/.test(input.postId)) throw new ValidationError('WordPress 内容 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const resource = await requestJson<WordPressEditableResource>(`${origin}/wp-json/wp/v2/${input.resourceType}/${input.postId}?context=edit&_fields=id,link,slug,status,modified_gmt,title,content,aioseo_meta_data,yoast_head,yoast_head_json`, {
      headers: { authorization: authorization(credentials), accept: 'application/json' }
    });
    return snapshotFromResource(resource, input.resourceType);
  },

  async readSiteContext(domain: string, encrypted: Uint8Array): Promise<WordPressSiteContext> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, settings, types] = await Promise.all([
      requestJson<RestRoot & { description?: string }>(`${origin}/wp-json`, { headers }),
      requestJson<{ title?: string; description?: string; url?: string; language?: string }>(`${origin}/wp-json/wp/v2/settings?context=edit&_fields=title,description,url,language`, { headers }).catch((): { title?: string; description?: string; url?: string; language?: string } => ({})),
      requestJson<Record<string, { slug?: string; rest_base?: string; viewable?: boolean }>>(`${origin}/wp-json/wp/v2/types?context=edit`, { headers }).catch(() => ({}))
    ]);
    const resourceTypes = [...new Set([
      'posts',
      'pages',
      ...Object.values(types)
        .filter((type) => type.viewable !== false && type.rest_base
          && /^[a-z0-9_-]+$/i.test(type.rest_base)
          && !['media', 'blocks', 'templates', 'navigation', 'products', 'orders'].includes(type.rest_base))
        .map((type) => String(type.rest_base))
    ])];
    if (resourceTypes.length > MAX_WORDPRESS_RESOURCE_TYPES) {
      throw new ValidationError(`WordPress 可公开内容类型超过 ${MAX_WORDPRESS_RESOURCE_TYPES} 个安全上限，已停止自动抓取`);
    }
    const fields = '_fields=id,link,slug,status,modified_gmt,type,title,excerpt,content,aioseo_meta_data,yoast_head,yoast_head_json';
    const [collections, categories, tags, media] = await Promise.all([
      Promise.all(resourceTypes.map(async (resourceType) => {
        try {
          return {
            resourceType,
            available: true,
            resources: await readAllResources<WordPressEditableResource>(new URL(`${origin}/wp-json/wp/v2/${encodeURIComponent(resourceType)}?context=edit&status=publish&orderby=modified&order=desc&${fields}`), headers)
          };
        } catch (error) {
          if (resourceType === 'posts' || resourceType === 'pages') throw error;
          return { resourceType, available: false, resources: [] as WordPressEditableResource[] };
        }
      })),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/categories?context=edit&_fields=id,name,slug,description,count`), headers),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/tags?context=edit&_fields=id,name,slug,description,count`), headers),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/media?context=edit&status=inherit&_fields=id,slug,title,caption,description,alt_text,media_type,mime_type,source_url`), headers)
    ]);
    const collectedResources = collections.flatMap(({ resourceType, resources: values }) => values.map((resource) => ({ resourceType, resource })));
    if (collectedResources.length > MAX_WORDPRESS_RESOURCES) {
      throw new ValidationError(`WordPress 公开内容总数超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限，请使用企业级分批审计流程`);
    }
    let totalContentBytes = 0;
    const resources = collectedResources
      .map(({ resourceType, resource }) => ({ ...resource, __resourceType: resourceType }))
      .filter((resource): resource is WordPressEditableResource & { __resourceType: string; id: number; link: string } =>
        Boolean(resource.id && resource.link && isSameOriginHttpsUrl(resource.link, origin)))
      .map((resource) => {
        const content = String(resource.content?.raw || resource.content?.rendered || '');
        const contentBytes = Buffer.byteLength(content, 'utf8');
        if (contentBytes > MAX_PAGE_CONTENT_BYTES) throw new ValidationError(`WordPress 页面 ${resource.link} 超过单页内容安全上限`);
        totalContentBytes += contentBytes;
        if (totalContentBytes > MAX_SITE_CONTENT_BYTES) throw new ValidationError('WordPress 站点内容体积超过自动审计安全上限，请使用企业级分批审计流程');
        return {
          wordpressId: String(resource.id),
          resourceType: String((resource as WordPressEditableResource & { __resourceType?: string }).__resourceType || resource.type || 'posts'),
          title: plainText(String(resource.title?.raw || resource.title?.rendered || resource.slug || resource.link)).slice(0, 200),
          url: comparableUrl(resource.link),
          slug: String(resource.slug || ''),
          status: String(resource.status || 'publish'),
          modifiedAt: resource.modified_gmt,
          excerpt: plainText(String(resource.excerpt?.raw || resource.excerpt?.rendered || '')).slice(0, 2_000),
          content,
          seoMetadata: {
            aioseoMetaData: resource.aioseo_meta_data || null,
            yoastHead: resource.yoast_head || null,
            yoastHeadJson: resource.yoast_head_json || null
          }
        };
      });
    const pages: WordPressSitePage[] = resources.map((resource) => {
      const editorKind = detectWordPressEditor(resource.content);
      const coreResource = resource.resourceType === 'posts' || resource.resourceType === 'pages';
      const resourceWritable = coreResource && routeSupports(itemRoute(root.routes, resource.resourceType), 'POST');
      return {
        ...resource,
        contentChecksum: createHash('sha256').update(resource.content).digest('hex'),
        wordCount: wordCount(resource.content),
        internalLinks: internalLinksFromHtml(resource.content, origin),
        editorKind,
        structureChecksum: wordpressStructureChecksum(resource.content, editorKind),
        actionCapabilities: wordpressPageActionCapabilities(editorKind, resource.content, resourceWritable)
      };
    });
    const internalLinks = [...new Map(pages.map(({ title, url }) => [url, { title, url }])).values()];
    const taxonomyContent = [...categories.items.map((item) => ({ type: 'CATEGORY', item })), ...tags.items.map((item) => ({ type: 'TAG', item }))]
      .map(({ type, item }) => `[${type}] ${plainText(String(item.name || ''))} ${plainText(String(item.description || ''))}`)
      .join('\n');
    const mediaContent = media.items
      .map((item) => `[MEDIA] ${plainText(String((item.title as { raw?: unknown; rendered?: unknown } | undefined)?.raw || (item.title as { rendered?: unknown } | undefined)?.rendered || item.slug || ''))} ${plainText(String(item.alt_text || ''))} ${plainText(String((item.caption as { raw?: unknown; rendered?: unknown } | undefined)?.raw || (item.caption as { rendered?: unknown } | undefined)?.rendered || ''))}`)
      .join('\n');
    const pageContent = pages
      .map(({ title, url, content: html }) => `[PAGE]\nURL: ${url}\nTITLE: ${title}\nCONTENT: ${plainText(html).slice(0, 20_000)}`)
      .join('\n\n');
    const site = {
      name: String(settings.title || root.name || new URL(origin).hostname),
      description: String(settings.description || root.description || ''),
      locale: settings.language ? String(settings.language) : undefined,
      url: String(settings.url || root.home || root.url || origin)
    };
    const inventory = {
      resourceTypes,
      unavailableResourceTypes: collections.filter(({ available }) => !available).map(({ resourceType }) => resourceType),
      categories: categories.items.length,
      tags: tags.items.length,
      media: media.items.length,
      categoriesAvailable: categories.available,
      tagsAvailable: tags.available,
      mediaAvailable: media.available
    };
    const content = `[SITE]\nNAME: ${plainText(site.name)}\nDESCRIPTION: ${plainText(site.description)}\n${taxonomyContent}\n${mediaContent}\n${pageContent}`
      .slice(0, 500_000);
    if (content.length < 100) throw new ValidationError('已验证的 WordPress 站点没有足够的已发布内容用于站点理解');
    return {
      normalizedUrl: origin,
      title: `WordPress content inventory for ${new URL(origin).hostname}`,
      content,
      checksum: wordpressSiteEvidenceFingerprint({ site, inventory, taxonomyContent, mediaContent, pages }),
      fetchedAt: new Date().toISOString(),
      internalLinks,
      pages,
      site,
      inventory
    };
  },

  async publish(input: { domain: string; encrypted: Uint8Array; title: string; slug: string; html: string; deliveryId: string }): Promise<WordPressMutationResult> {
    assertDeliveryId(input.deliveryId);
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const auth = authorization(credentials);
    const marker = deliveryMarker(input.deliveryId);
    const existing = await requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(input.slug)}&context=edit&status=any&_fields=id,link,slug,status,modified_gmt,title,content`, { headers: { authorization: auth, accept: 'application/json' } });
    const replay = existing.find((post) => String(post.content?.raw || post.content?.rendered || '').includes(marker));
    if (replay?.id && replay.link) {
      if (replay.status !== 'publish') {
        await requestJson(`${origin}/wp-json/wp/v2/posts/${replay.id}`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'publish' })
        });
      }
      const snapshot = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: replay.link, resourceType: 'posts' });
      const [verification, remoteRevisionId] = await Promise.all([
        verifyPublicMutation({ url: replay.link, actionType: 'CREATE_CONTENT', expectedTitle: input.title, deliveryId: input.deliveryId, afterContent: input.html }),
        latestRevisionId(origin, 'posts', String(replay.id), { authorization: auth, accept: 'application/json' })
      ]);
      return { postId: String(replay.id), url: replay.link, snapshot, changedFields: ['title', 'slug', 'content', 'status'], verification, remoteRevisionId };
    }
    if (existing.length) throw new ConflictError('WordPress 已存在相同 slug 的其他内容，已停止发布以避免误绑定或覆盖');
    const prepared = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, slug: input.slug, content: `${marker}\n${input.html}`, status: 'draft' })
    });
    if (!prepared.id || !prepared.link) throw new ExternalServiceError('WordPress 创建草稿后未返回文章 ID 或链接');
    const preparedSnapshot = await this.readResourceById({ domain: input.domain, encrypted: input.encrypted, postId: String(prepared.id), resourceType: 'posts' });
    if (!preparedSnapshot.content.includes(marker) || preparedSnapshot.title !== input.title) {
      throw new ExternalServiceError('WordPress 草稿回读与待发布内容不一致，已停止发布');
    }
    const committed = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/posts/${prepared.id}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'publish' })
    });
    if (!committed.id || !committed.link) throw new ExternalServiceError('WordPress 发布后未返回文章 ID 或链接');
    const snapshot = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: String(committed.link), resourceType: 'posts' });
    if (!snapshot.content.includes(marker) || snapshot.title !== input.title || snapshot.status !== 'publish') {
      throw new ExternalServiceError('WordPress 发布后 REST 回读验证失败');
    }
    const [verification, remoteRevisionId] = await Promise.all([
      verifyPublicMutation({ url: String(committed.link), actionType: 'CREATE_CONTENT', expectedTitle: input.title, deliveryId: input.deliveryId, afterContent: input.html }),
      latestRevisionId(origin, 'posts', String(committed.id), { authorization: auth, accept: 'application/json' })
    ]);
    return { postId: String(committed.id), url: String(committed.link), snapshot, changedFields: ['title', 'slug', 'content', 'status'], verification, remoteRevisionId };
  },

  async update(input: {
    domain: string;
    encrypted: Uint8Array;
    snapshot: WordPressEditableSnapshot;
    title: string;
    html: string;
    deliveryId: string;
    actionType: Exclude<WordPressGrowthAction, 'CREATE_CONTENT' | 'DIAGNOSE_ONLY'>;
    capability: WordPressActionCapability;
  }): Promise<WordPressMutationResult> {
    assertDeliveryId(input.deliveryId);
    if (!/^\d+$/.test(input.snapshot.postId)) throw new ValidationError('WordPress 内容 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const current = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.snapshot.url, resourceType: input.snapshot.resourceType });
    const marker = deliveryMarker(input.deliveryId);
    const replayChangedFields = input.actionType === 'UPDATE_TITLE' ? ['title'] : ['content'];
    const publicReplay = input.actionType === 'UPDATE_TITLE'
      ? await verifyPublicMutation({ url: current.url, actionType: 'UPDATE_TITLE', expectedTitle: input.title })
      : undefined;
    const currentAioseo = current.seoMetadata.aioseoMetaData as Record<string, unknown> | null;
    const titleAlreadyApplied = input.capability.strategy === 'AIOSEO_REST'
      ? String(currentAioseo?.title || '') === input.title
      : current.title === input.title;
    if ((input.actionType === 'UPDATE_TITLE' && (publicReplay?.titleMatches || (titleAlreadyApplied && current.contentChecksum === input.snapshot.contentChecksum)))
      || (input.actionType !== 'UPDATE_TITLE' && current.content.includes(marker))) {
      const remoteRevisionId = await latestRevisionId(origin, current.resourceType, current.postId, { authorization: authorization(credentials), accept: 'application/json' });
      return {
        postId: current.postId,
        url: current.url,
        snapshot: current,
        changedFields: replayChangedFields,
        verification: publicReplay || await verifyPublicMutation({
          url: current.url,
          actionType: input.actionType,
          deliveryId: input.deliveryId,
          beforeContent: input.snapshot.content,
          afterContent: input.html
        }),
        remoteRevisionId
      };
    }
    const changedFields = assertSafeWordPressMutation({ actionType: input.actionType, before: input.snapshot, afterTitle: input.title, afterContent: input.html });
    const originalAioseo = input.snapshot.seoMetadata.aioseoMetaData as Record<string, unknown> | null;
    const titleBaselineChanged = input.actionType === 'UPDATE_TITLE' && (input.capability.strategy === 'AIOSEO_REST'
      ? String(currentAioseo?.title || '') !== String(originalAioseo?.title || '')
      : current.title !== input.snapshot.title);
    if (current.postId !== input.snapshot.postId
      || current.modifiedAt !== input.snapshot.modifiedAt
      || current.contentChecksum !== input.snapshot.contentChecksum
      || titleBaselineChanged) {
      throw new ConflictError('WordPress 页面在执行期间已被修改，已停止写入以保护客户最新内容');
    }
    const writePayload: Record<string, unknown> = {};
    if (input.actionType === 'UPDATE_TITLE') {
      if (input.capability.strategy === 'AIOSEO_REST') writePayload.aioseo_meta_data = { title: input.title };
      else if (input.capability.strategy === 'CORE_FIELD') writePayload.title = input.title;
      else throw new ValidationError('兼容档案没有为标题动作提供可写策略');
    } else {
      writePayload.content = `${marker}\n${input.html}`;
    }
    const body = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/${input.snapshot.resourceType}/${input.snapshot.postId}`, {
      method: 'POST',
      headers: { authorization: authorization(credentials), 'content-type': 'application/json' },
      body: JSON.stringify(writePayload)
    });
    if (!body.id || !body.link) throw new ExternalServiceError('WordPress 更新后未返回内容 ID 或链接');
    const snapshot = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: String(body.link), resourceType: input.snapshot.resourceType });
    if (input.actionType !== 'UPDATE_TITLE' && !snapshot.content.includes(marker)) throw new ExternalServiceError('WordPress 更新后 REST 回读未发现交付标识');
    if (input.actionType === 'UPDATE_TITLE') {
      const updatedAioseo = snapshot.seoMetadata.aioseoMetaData as Record<string, unknown> | null;
      const titleRoundTripMatches = input.capability.strategy === 'AIOSEO_REST'
        ? String(updatedAioseo?.title || '') === input.title
        : snapshot.title === input.title;
      if (!titleRoundTripMatches) throw new ExternalServiceError('WordPress 标题更新后未通过 REST 字段回读验证');
    }
    const [verification, remoteRevisionId] = await Promise.all([
      verifyPublicMutation({
        url: String(body.link),
        actionType: input.actionType,
        ...(input.actionType === 'UPDATE_TITLE'
          ? { expectedTitle: input.title }
          : { deliveryId: input.deliveryId, beforeContent: input.snapshot.content, afterContent: input.html })
      }),
      latestRevisionId(origin, input.snapshot.resourceType, input.snapshot.postId, { authorization: authorization(credentials), accept: 'application/json' })
    ]);
    return { postId: String(body.id), url: String(body.link), snapshot, changedFields, verification, remoteRevisionId };
  },

  async restore(input: { domain: string; encrypted: Uint8Array; snapshot: WordPressEditableSnapshot; expectedCurrent?: WordPressEditableSnapshot; changedFields: string[]; capability?: WordPressActionCapability }): Promise<WordPressEditableSnapshot> {
    if (!/^\d+$/.test(input.snapshot.postId)) throw new ValidationError('WordPress 内容 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    if (input.expectedCurrent) {
      const current = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.expectedCurrent.url });
      const titleChanged = input.changedFields.includes('title')
        && input.capability?.strategy !== 'AIOSEO_REST'
        && current.title !== input.expectedCurrent.title;
      const seoMetadataChanged = input.capability?.strategy === 'AIOSEO_REST'
        && JSON.stringify(current.seoMetadata.aioseoMetaData || null) !== JSON.stringify(input.expectedCurrent.seoMetadata.aioseoMetaData || null);
      if (current.postId !== input.expectedCurrent.postId
        || current.contentChecksum !== input.expectedCurrent.contentChecksum
        || current.modifiedAt !== input.expectedCurrent.modifiedAt
        || titleChanged
        || seoMetadataChanged) {
        throw new ConflictError('WordPress 页面在交付后已被客户修改，自动回滚已停止以避免覆盖新内容');
      }
    }
    const payload: Record<string, unknown> = {};
    for (const field of input.changedFields) {
      if (field === 'title' && input.capability?.strategy === 'AIOSEO_REST') payload.aioseo_meta_data = input.snapshot.seoMetadata.aioseoMetaData || {};
      else if (field === 'title') payload.title = input.snapshot.title;
      else if (field === 'content') payload.content = input.snapshot.content;
      else if (field === 'status') payload.status = input.snapshot.status;
    }
    if (!Object.keys(payload).length) throw new ValidationError('回滚记录没有可恢复字段');
    await requestJson(`${origin}/wp-json/wp/v2/${input.snapshot.resourceType}/${input.snapshot.postId}`, {
      method: 'POST',
      headers: { authorization: authorization(credentials), 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.snapshot.url });
  },

  async rollback(input: { domain: string; encrypted: Uint8Array; postId: string }): Promise<void> {
    if (!/^\d+$/.test(input.postId)) throw new ValidationError('WordPress 文章 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const response = await fetch(`${origin}/wp-json/wp/v2/posts/${input.postId}`, {
      method: 'DELETE',
      redirect: 'manual',
      headers: { authorization: authorization(credentials), accept: 'application/json' },
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      throw new ExternalServiceError(`WordPress 回滚失败 (${response.status}): ${body.message || response.statusText}`);
    }
  }
};
