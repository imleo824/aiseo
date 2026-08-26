import sanitizeHtml from 'sanitize-html';

const allowedTags = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption',
  'img', 'a', 'details', 'summary', 'div', 'span'
];

export function sanitizeArticleHtml(html: string): string {
  const jsonLdBlocks = Array.from(html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .flatMap((match) => {
      try {
        const json = JSON.parse(match[1]);
        return [`<script type="application/ld+json">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>`];
      } catch {
        return [];
      }
    });

  const sanitized = sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      '*': ['class'],
      a: ['href', 'target', 'rel', 'class'],
      img: ['src', 'alt', 'width', 'height', 'class', 'loading'],
      details: ['open', 'class'],
      summary: ['class']
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          target: attribs.target === '_blank' ? '_blank' : undefined,
          rel: attribs.target === '_blank' ? 'noopener noreferrer' : attribs.rel
        }
      })
    }
  });

  return [sanitized, ...jsonLdBlocks].join('');
}
