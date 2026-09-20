import { Fragment } from 'react';
import { legalDocuments, type LegalDocumentPath } from '../legalDocuments';

export const legalDocumentForPath = (path: string): LegalDocumentPath | undefined => (
  Object.hasOwn(legalDocuments, path) ? path as LegalDocumentPath : undefined
);

type LegalBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export const parseLegalMarkdown = (markdown: string): LegalBlock[] => {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (items.length) blocks.push({ type: 'list', items });
    items = [];
  };
  for (const sourceLine of markdown.replace(/\r/g, '').split('\n')) {
    const line = sourceLine.trim();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
    } else if (listItem) {
      flushParagraph();
      items.push(listItem[1]);
    } else if (!line) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
};

export function LegalDocumentPage({ documentPath }: { documentPath: LegalDocumentPath }) {
  const blocks = parseLegalMarkdown(legalDocuments[documentPath]);
  return (
    <main className="min-h-[100dvh] bg-slate-50/80 px-4 py-8 text-slate-900 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm sm:p-10">
        <a href="/" className="mb-7 inline-flex min-h-[40px] items-center text-sm font-semibold text-slate-600 hover:text-slate-950">← 返回登录</a>
        <div className="space-y-4 leading-7">
            {blocks.map((block, index) => (
              <Fragment key={`${block.type}-${index}`}>
                {block.type === 'heading' && block.level === 1 && <h1 className="mb-7 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{block.text}</h1>}
                {block.type === 'heading' && block.level === 2 && <h2 className="pt-4 text-lg font-bold text-slate-950">{block.text}</h2>}
                {block.type === 'heading' && block.level === 3 && <h3 className="pt-3 text-base font-bold text-slate-900">{block.text}</h3>}
                {block.type === 'paragraph' && <p className="text-sm text-slate-700 sm:text-base">{block.text}</p>}
                {block.type === 'list' && <ul className="list-disc space-y-2 pl-6 text-sm text-slate-700 sm:text-base">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>}
              </Fragment>
            ))}
        </div>
      </article>
    </main>
  );
}
