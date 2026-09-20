import { describe, expect, it } from 'vitest';
import { legalDocumentForPath, parseLegalMarkdown } from './LegalDocumentPage';

describe('legal documents', () => {
  it('only maps explicit public legal routes', () => {
    expect(legalDocumentForPath('/legal/terms')).toBe('/legal/terms');
    expect(legalDocumentForPath('/legal/TERMS.md')).toBeUndefined();
    expect(legalDocumentForPath('/legal/../runtime-config.js')).toBeUndefined();
  });

  it('renders trusted markdown as text blocks without HTML injection', () => {
    expect(parseLegalMarkdown('# 条款\n\n说明文本\n\n- 第一项\n- <script>alert(1)</script>')).toEqual([
      { type: 'heading', level: 1, text: '条款' },
      { type: 'paragraph', text: '说明文本' },
      { type: 'list', items: ['第一项', '<script>alert(1)</script>'] }
    ]);
  });
});
