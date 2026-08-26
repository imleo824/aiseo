import { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface SafeArticleContentProps {
  html?: string;
  className?: string;
}

const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['style']
};

export function SafeArticleContent({ html, className }: SafeArticleContentProps) {
  const sanitizedHtml = useMemo(
    () => DOMPurify.sanitize(html || '<p>暂无内容</p>', SANITIZE_OPTIONS),
    [html]
  );

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
