import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { ExternalServiceError } from '../domain/errors';

const modelOutput = z.object({
  title: z.string().trim().min(10).max(180),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  html: z.string().min(200),
  coverageTopics: z.array(z.string().trim().min(2).max(180)).max(30).default([]),
  claimSources: z.array(z.object({
    claim: z.string().trim().min(2).max(500),
    sourceTitle: z.string().trim().min(2).max(200)
  })).max(50).default([])
});
const keywordOutput = z.object({ keyword: z.string().trim().min(2).max(120), rationale: z.string().trim().min(10).max(500) });
const titleOutput = z.object({ title: z.string().trim().min(10).max(70), rationale: z.string().trim().min(10).max(500) });
const sectionOutput = z.object({
  heading: z.string().trim().min(5).max(180),
  html: z.string().trim().min(100).max(20_000),
  coverageTopics: z.array(z.string().trim().min(2).max(180)).max(20).default([]),
  claimSources: z.array(z.object({
    claim: z.string().trim().min(2).max(500),
    sourceTitle: z.string().trim().min(2).max(200)
  })).max(30).default([])
});
const refreshOutput = z.object({
  targetHtml: z.string().min(20).max(80_000),
  replacementHtml: z.string().trim().min(100).max(80_000),
  coverageTopics: z.array(z.string().trim().min(2).max(180)).min(1).max(30),
  claimSources: z.array(z.object({
    claim: z.string().trim().min(2).max(500),
    sourceTitle: z.string().trim().min(2).max(200)
  })).max(50).default([]),
  changeSummary: z.array(z.string().trim().min(2).max(300)).min(1).max(20)
});
const briefOutput = z.object({
  audience: z.string().trim().min(2).max(300),
  searchIntent: z.enum(['informational', 'commercial', 'transactional', 'navigational', 'mixed']),
  pageGoal: z.string().trim().min(10).max(500),
  requiredTopics: z.array(z.string().trim().min(2).max(180)).min(2).max(20),
  userQuestions: z.array(z.string().trim().min(2).max(300)).min(1).max(20),
  allowedSiteFacts: z.array(z.object({
    fact: z.string().trim().min(2).max(500),
    sourceTitle: z.string().trim().min(2).max(200)
  })).max(40),
  forbiddenClaims: z.array(z.string().trim().min(2).max(300)).max(20),
  internalLinkTargets: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    url: z.string().url()
  })).max(8)
});

export type ContentBrief = z.infer<typeof briefOutput>;

const normalizedEvidenceText = (value: string): string => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
  .toLocaleLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();
const evidenceTokens = (value: string): string[] => normalizedEvidenceText(value)
  .match(/[a-z0-9][a-z0-9-]{1,}|\p{Script=Han}{2,}/gu) || [];
const supportedByEvidence = (claim: string, source: string): boolean => {
  const normalizedClaim = normalizedEvidenceText(claim);
  const normalizedSource = normalizedEvidenceText(source);
  if (normalizedClaim.length >= 6 && normalizedSource.includes(normalizedClaim)) return true;
  const tokens = [...new Set(evidenceTokens(claim))];
  return tokens.length > 0 && tokens.filter((token) => normalizedSource.includes(token)).length / tokens.length >= 0.6;
};
const comparableHttpsUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
};

export const validateContentBriefEvidence = (
  brief: ContentBrief,
  knowledge: Array<{ title: string; content: string }>,
  internalLinks: Array<{ title: string; url: string }>
): ContentBrief => {
  const sources = new Map(knowledge.map((source) => [normalizedEvidenceText(source.title), source]));
  for (const fact of brief.allowedSiteFacts) {
    const source = sources.get(normalizedEvidenceText(fact.sourceTitle));
    if (!source || !source.title.startsWith('[TARGET_SITE]') || !supportedByEvidence(fact.fact, source.content)) {
      throw new ExternalServiceError('AI 内容简报包含无法从客户站点证据验证的事实');
    }
  }
  const allowedLinks = new Set(internalLinks.map(({ url }) => comparableHttpsUrl(url)).filter((url): url is string => Boolean(url)));
  if (brief.internalLinkTargets.some(({ url }) => {
    const normalized = comparableHttpsUrl(url);
    return !normalized || !allowedLinks.has(normalized);
  })) {
    throw new ExternalServiceError('AI 内容简报包含未经验证的内部链接');
  }
  return brief;
};

const cleanJson = (value: string): unknown => JSON.parse(value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
const askModel = async (prompt: string, temperature: number): Promise<string> => {
  if (process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o', temperature, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return strict JSON only. Never fabricate metrics, facts, sources, quotes, or results.' }, { role: 'user', content: prompt }] });
    const raw = completion.choices[0]?.message?.content;
    if (raw) return raw;
  } else if (process.env.GEMINI_API_KEY) {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const completion = await client.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-pro', contents: prompt, config: { responseMimeType: 'application/json', temperature } });
    if (completion.text) return completion.text;
  } else {
    throw new ExternalServiceError('OpenAI/Gemini 均未配置，AI 任务已失败关闭');
  }
  throw new ExternalServiceError('AI 服务未返回内容');
};

const deterministicQualityGate = (html: string, title: string) => {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
  const headings = (html.match(/<h[2-3]\b/gi) || []).length;
  const forbidden = /javascript:|data:text\/html|<script\b|on\w+\s*=/i.test(html);
  const checks = [
    { name: 'TITLE', passed: title.length >= 10 && title.length <= 180 },
    { name: 'NON_EMPTY', passed: text.length >= 100, detail: `characters=${text.length}` },
    { name: 'STRUCTURE', passed: headings >= 1, detail: `headings=${headings}` },
    { name: 'ACTIVE_CONTENT', passed: !forbidden }
  ];
  return { passed: checks.every(({ passed }) => passed), score: Math.round(checks.filter(({ passed }) => passed).length / checks.length * 100), checks, generatedAt: new Date().toISOString(), version: 'quality-gate-1' };
};

export const contentAi = {
  async deriveKeyword(input: { language: string; sourceType: 'SITE' | 'REFERENCE_URL' | 'COMPETITOR_SITE'; title: string; content: string }) {
    const prompt = JSON.stringify({
      task: input.sourceType === 'SITE'
        ? 'Select one commercially meaningful seed keyword that accurately represents this website. Do not invent products, demand, volume, ranking, or facts.'
        : input.sourceType === 'REFERENCE_URL'
          ? 'Select one seed keyword that captures the reference article topic for an original, non-copying treatment. Do not claim search demand or ranking.'
          : 'Select one non-branded commercially meaningful seed query that represents the competitor page category or search intent. Do not append generic words such as alternative unless the source supports that intent. Do not invent products, weaknesses, demand, traffic, or rankings.',
      language: input.language,
      sourceTitle: input.title,
      sourceText: input.content.slice(0, 20_000),
      output: { keyword: '2-120 character seed keyword', rationale: 'brief evidence-grounded reason' }
    });
    const raw = await askModel(prompt, 0);
    try { return keywordOutput.parse(cleanJson(raw)); } catch { throw new ExternalServiceError('AI 主题解析结果不符合正式 JSON 契约'); }
  },

  async createBrief(input: {
    keyword: string;
    language: string;
    searchIntent: string | null;
    seoSnapshot: unknown;
    knowledge: Array<{ title: string; content: string }>;
    internalLinks: Array<{ title: string; url: string }>;
  }): Promise<ContentBrief> {
    const prompt = JSON.stringify({
      task: 'Create a source-grounded SEO execution brief. The brief must solve the observed search intent using customer-site facts. External reference or competitor material can identify gaps but cannot be presented as customer facts. If a claim is not supported, put it in forbiddenClaims. Do not use word count as a ranking rule.',
      language: input.language,
      keyword: input.keyword,
      observedSearchIntent: input.searchIntent,
      seoSnapshot: input.seoSnapshot,
      sources: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 20_000) })),
      internalLinks: input.internalLinks.slice(0, 8),
      output: {
        audience: 'who the page must help',
        searchIntent: 'informational|commercial|transactional|navigational|mixed',
        pageGoal: 'single useful outcome',
        requiredTopics: ['evidence-backed topics that must be covered'],
        userQuestions: ['questions the page must answer'],
        allowedSiteFacts: [{ fact: 'customer fact', sourceTitle: 'exact supplied source title' }],
        forbiddenClaims: ['unsupported claims or promises'],
        internalLinkTargets: [{ title: 'existing page', url: 'https URL' }]
      }
    });
    try {
      return validateContentBriefEvidence(
        briefOutput.parse(cleanJson(await askModel(prompt, 0))),
        input.knowledge,
        input.internalLinks
      );
    } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError('AI 内容简报结果不符合正式 JSON 契约');
    }
  },

  async generate(input: { keyword: string; language: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }>; brief: ContentBrief; internalLinks?: Array<{ title: string; url: string }> }) {
    const prompt = JSON.stringify({
      task: 'Create an original, publication-ready SEO article using only the supplied metrics and sources. Titles prefixed [TARGET_SITE] describe the customer; [REFERENCE] and [COMPETITOR] are inspiration or gap evidence only and must not be copied or presented as customer facts. Never invent traffic, ranking, quotes, studies, or product facts.',
      language: input.language,
      keyword: input.keyword,
      brief: input.brief,
      seoSnapshot: input.seoSnapshot,
      knowledge: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 20_000) })),
      output: {
        title: 'string',
        slug: 'lowercase-ascii-kebab-case',
        html: 'semantic article HTML that covers the brief; no automatic bibliography section',
        coverageTopics: 'requiredTopics actually covered',
        claimSources: [{ claim: 'factual claim used', sourceTitle: 'exact supplied source title' }]
      }
    });
    const raw = await askModel(prompt, 0.2);
    let parsed: z.infer<typeof modelOutput>;
    try { parsed = modelOutput.parse(cleanJson(raw)); } catch { throw new ExternalServiceError('AI 返回内容不符合正式 JSON 契约'); }
    const sanitized = sanitizeHtml(parsed.html, {
      allowedTags: ['article', 'section', 'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['https']
    });
    return {
      ...parsed,
      html: sanitized,
      qualityReport: {
        ...deterministicQualityGate(sanitized, parsed.title),
        internalLinks: { inserted: 0, items: [] }
      }
    };
  },

  async optimizeTitle(input: { keyword: string; language: string; currentTitle: string; pageText: string; seoSnapshot: unknown }) {
    const prompt = JSON.stringify({
      task: 'Improve only the SEO title for an existing page with verified high impressions and low CTR. Preserve the page meaning and brand accuracy. Do not promise rankings, invent benefits, or use clickbait.',
      language: input.language,
      keyword: input.keyword,
      currentTitle: input.currentTitle,
      pageText: input.pageText.slice(0, 12_000),
      seoSnapshot: input.seoSnapshot,
      output: { title: '10-70 characters', rationale: 'brief evidence-grounded reason' }
    });
    try { return titleOutput.parse(cleanJson(await askModel(prompt, 0))); } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError('AI 标题优化结果不符合正式 JSON 契约');
    }
  },

  async generateSection(input: { keyword: string; language: string; currentTitle: string; currentHtml: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }>; brief: ContentBrief }) {
    const prompt = JSON.stringify({
      task: 'Write one original missing section to append to the existing page. Return only the new semantic HTML section. Do not repeat existing content, copy references, or invent facts, quotes, studies, metrics, products, or customer claims.',
      language: input.language,
      keyword: input.keyword,
      currentTitle: input.currentTitle,
      currentPage: input.currentHtml.slice(0, 20_000),
      seoSnapshot: input.seoSnapshot,
      brief: input.brief,
      knowledge: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 12_000) })),
      output: {
        heading: 'section heading',
        html: 'one <section> containing an H2 and evidence-grounded body',
        coverageTopics: 'brief topics actually covered by this section',
        claimSources: [{ claim: 'factual claim used', sourceTitle: 'exact supplied source title' }]
      }
    });
    let parsed: z.infer<typeof sectionOutput>;
    try { parsed = sectionOutput.parse(cleanJson(await askModel(prompt, 0.1))); } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError('AI 增补内容结果不符合正式 JSON 契约');
    }
    const html = sanitizeHtml(parsed.html, {
      allowedTags: ['section', 'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['https']
    });
    if (html.length < 100 || !/<h2\b/i.test(html)) throw new ExternalServiceError('增补内容未通过结构门禁');
    return { ...parsed, html };
  },

  async refreshContent(input: { keyword: string; language: string; currentTitle: string; currentHtml: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }>; brief: ContentBrief }) {
    const prompt = JSON.stringify({
      task: 'Return one bounded local replacement for the existing page. targetHtml must be copied byte-for-byte from one unique contiguous fragment of currentPage and must cover no more than 60% of the visible page. replacementHtml replaces only that fragment, preserves supported customer facts and any unknown WordPress markup, and closes a verified intent gap. Never return the complete page. Do not copy references or invent facts, quotes, studies, metrics, products, customer claims, traffic, or rankings.',
      language: input.language,
      keyword: input.keyword,
      currentTitle: input.currentTitle,
      currentPage: input.currentHtml.slice(0, 60_000),
      seoSnapshot: input.seoSnapshot,
      brief: input.brief,
      knowledge: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 20_000) })),
      output: {
        targetHtml: 'one exact, unique, unchanged fragment copied from currentPage',
        replacementHtml: 'semantic HTML replacing only targetHtml; never the complete page',
        coverageTopics: 'brief topics actually covered',
        claimSources: [{ claim: 'factual claim used', sourceTitle: 'exact supplied source title' }],
        changeSummary: ['specific meaningful changes made']
      }
    });
    let parsed: z.infer<typeof refreshOutput>;
    try { parsed = refreshOutput.parse(cleanJson(await askModel(prompt, 0.1))); } catch (error) {
      if (error instanceof ExternalServiceError) throw error;
      throw new ExternalServiceError('AI 内容刷新结果不符合正式 JSON 契约');
    }
    const replacementHtml = sanitizeHtml(parsed.replacementHtml, {
      allowedTags: ['article', 'section', 'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['https']
    });
    if (replacementHtml.length < 100 || !/<h[2-3]\b/i.test(replacementHtml)) throw new ExternalServiceError('内容刷新未通过结构门禁');
    return { ...parsed, replacementHtml };
  }
};
