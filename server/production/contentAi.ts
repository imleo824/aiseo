import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { ExternalServiceError } from '../domain/errors';

const modelOutput = z.object({ title: z.string().trim().min(10).max(180), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180), html: z.string().min(1_000) });
const keywordOutput = z.object({ keyword: z.string().trim().min(2).max(120), rationale: z.string().trim().min(10).max(500) });
const titleOutput = z.object({ title: z.string().trim().min(10).max(70), rationale: z.string().trim().min(10).max(500) });
const sectionOutput = z.object({ heading: z.string().trim().min(5).max(180), html: z.string().trim().min(300).max(20_000) });

const cleanJson = (value: string): unknown => JSON.parse(value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  const chineseCharacters = (text.match(/\p{Script=Han}/gu) || []).length;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const headings = (html.match(/<h[2-3]\b/gi) || []).length;
  const forbidden = /javascript:|data:text\/html|<script\b|on\w+\s*=/i.test(html);
  const checks = [
    { name: 'TITLE', passed: title.length >= 10 && title.length <= 180 },
    { name: 'SUBSTANCE', passed: chineseCharacters >= 800 || words >= 450, detail: `han=${chineseCharacters}, words=${words}` },
    { name: 'STRUCTURE', passed: headings >= 2, detail: `headings=${headings}` },
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

  async generate(input: { keyword: string; language: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }>; internalLinks?: Array<{ title: string; url: string }> }) {
    const prompt = JSON.stringify({
      task: 'Create an original, publication-ready SEO article using only the supplied metrics and sources. Titles prefixed [TARGET_SITE] describe the customer; [REFERENCE] and [COMPETITOR] are inspiration or gap evidence only and must not be copied or presented as customer facts. Never invent traffic, ranking, quotes, studies, or product facts.',
      language: input.language,
      keyword: input.keyword,
      seoSnapshot: input.seoSnapshot,
      knowledge: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 20_000) })),
      output: { title: 'string', slug: 'lowercase-ascii-kebab-case', html: 'semantic article HTML with H2/H3 sections' }
    });
    const raw = await askModel(prompt, 0.2);
    let parsed: z.infer<typeof modelOutput>;
    try { parsed = modelOutput.parse(cleanJson(raw)); } catch { throw new ExternalServiceError('AI 返回内容不符合正式 JSON 契约'); }
    const sanitized = sanitizeHtml(parsed.html, {
      allowedTags: ['article', 'section', 'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['https']
    });
    const internalLinks = (input.internalLinks || []).filter(({ title, url }) => {
      try { return Boolean(title.trim()) && new URL(url).protocol === 'https:'; } catch { return false; }
    }).slice(0, 3);
    const internalLinkSection = internalLinks.length
      ? `<section class="aiseo-internal-links"><h2>相关阅读</h2><ul>${internalLinks.map(({ title, url }) => `<li><a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(title)}</a></li>`).join('')}</ul></section>`
      : '';
    const html = `${sanitized}${internalLinkSection}`;
    return {
      ...parsed,
      html,
      qualityReport: {
        ...deterministicQualityGate(html, parsed.title),
        internalLinks: { inserted: internalLinks.length, items: internalLinks }
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

  async generateSection(input: { keyword: string; language: string; currentTitle: string; currentHtml: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }> }) {
    const prompt = JSON.stringify({
      task: 'Write one original missing section to append to the existing page. Return only the new semantic HTML section. Do not repeat existing content, copy references, or invent facts, quotes, studies, metrics, products, or customer claims.',
      language: input.language,
      keyword: input.keyword,
      currentTitle: input.currentTitle,
      currentPage: input.currentHtml.slice(0, 20_000),
      seoSnapshot: input.seoSnapshot,
      knowledge: input.knowledge.map((source) => ({ title: source.title, content: source.content.slice(0, 12_000) })),
      output: { heading: 'section heading', html: 'one <section> containing an H2 and evidence-grounded body, minimum 300 characters' }
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
    if (html.length < 300 || !/<h2\b/i.test(html)) throw new ExternalServiceError('增补内容未通过结构门禁');
    return { ...parsed, html };
  }
};
