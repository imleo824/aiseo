import { describe, expect, it } from 'vitest';
import { sanitizeArticleHtml } from './contentSanitizer';

describe('sanitizeArticleHtml', () => {
  it('removes executable markup and unsafe URLs while preserving safe article content', () => {
    const html = sanitizeArticleHtml('<h2>Safe</h2><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com" target="_blank">good</a>');

    expect(html).toContain('<h2>Safe</h2>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
