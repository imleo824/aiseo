import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { ExternalServiceError } from '../domain/errors';

const modelOutput = z.object({ title: z.string().trim().min(10).max(180), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180), html: z.string().min(1_000) });

const cleanJson = (value: string): unknown => JSON.parse(value.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, ''));

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
  async generate(input: { keyword: string; language: string; seoSnapshot: unknown; knowledge: Array<{ title: string; content: string }> }) {
    const prompt = JSON.stringify({
      task: 'Create an original, publication-ready SEO article using only the supplied metrics and customer knowledge. Never invent traffic, ranking, quotes, studies, or product facts.',
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
    const html = sanitizeHtml(parsed.html, {
      allowedTags: ['article', 'section', 'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'title', 'rel'] },
      allowedSchemes: ['https']
    });
    return { ...parsed, html, qualityReport: deterministicQualityGate(html, parsed.title) };
  }
};
