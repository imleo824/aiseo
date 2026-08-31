import { useMemo } from 'react';

interface SafeArticleContentProps {
  html?: string;
  className?: string;
}

const ALLOWED_TAGS = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR']);
const escapeText = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

const sanitizeArticleHtml = (value: string): string => {
  if (typeof DOMParser === 'undefined') return `<p>${escapeText(value)}</p>`;
  const document = new DOMParser().parseFromString(value, 'text/html');
  const elements = Array.from(document.body.querySelectorAll('*'));
  for (const element of elements) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const allowed = element.tagName === 'A' && ['href', 'title', 'target', 'rel'].includes(attribute.name);
      if (!allowed) element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href');
      if (href && !/^(https?:|mailto:)/i.test(href)) element.removeAttribute('href');
      element.setAttribute('rel', 'noopener noreferrer');
      if (element.getAttribute('target') !== '_blank') element.removeAttribute('target');
    }
  }
  return document.body.innerHTML;
};

export function SafeArticleContent({ html, className }: SafeArticleContentProps) {
  const sanitizedHtml = useMemo(
    () => sanitizeArticleHtml(html || '<p>暂无内容</p>'),
    [html]
  );

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
