import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { ExternalServiceError } from '../domain/errors';

const modelOutput = z.object({ title: z.string().trim().min(10).max(180), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180), html: z.string().min(1_000) });
const keywordOutput = z.object({ keyword: z.string().trim().min(2).max(120), rationale: z.string().trim().min(10).max(500) });

const cleanJson = (value: string): unknown => JSON.parse(value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  async deriveKeyword(input: { language: string; sourceType: 'SITE' | 'REWRITE_URL' | 'COMPETITOR_URL'; title: string; content: string }) {
    const prompt = JSON.stringify({
      task: input.sourceType === 'SITE'
        ? 'Select one commercially meaningful seed keyword that accurately represents this website. Do not invent products, demand, volume, ranking, or facts.'
        : input.sourceType === 'REWRITE_URL'
          ? 'Select one seed keyword that captures the licensed source article topic for an original, non-copying rewrite. Do not claim search demand or ranking.'
          : 'Select one non-branded commercially meaningful seed query that represents the competitor page category or search intent. Do not append generic words such as alternative unless the source supports that intent. Do not invent products, weaknesses, demand, traffic, or rankings.',
      language: input.language,
      sourceTitle: input.title,
      sourceText: input.content.slice(0, 20_000),
      output: { keyword: '2-120 character seed keyword', rationale: 'brief evidence-grounded reason' }
    });
    let raw: string | undefined;
    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o', temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return strict JSON only. Never fabricate metrics or facts.' }, { role: 'user', content: prompt }] });
      raw = completion.choices[0]?.message?.content || undefined;
    } else if (process.env.GEMINI_API_KEY) {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const completion = await client.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-pro', contents: prompt, config: { responseMimeType: 'application/json', temperature: 0 } });
      raw = completion.text;
    } else {
      throw new ExternalServiceError('OpenAI/Gemini 均未配置，无法从站点或文章解析主题');
    }
    if (!raw) throw new ExternalServiceError('AI 服务未返回主题解析结果');
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
    let raw: string | undefined;
    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({ model: process.env.OPENAI_MODEL || 'gpt-4o', temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return strict JSON only. Evidence provenance is mandatory.' }, { role: 'user', content: prompt }] });
      raw = completion.choices[0]?.message?.content || undefined;
    } else if (process.env.GEMINI_API_KEY) {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const completion = await client.models.generateContent({ model: process.env.GEMINI_MODEL || 'gemini-2.5-pro', contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.2 } });
      raw = completion.text;
    } else {
      throw new ExternalServiceError('OpenAI/Gemini 均未配置，内容任务已失败关闭');
    }
    if (!raw) throw new ExternalServiceError('AI 服务未返回内容');
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
  }
};
