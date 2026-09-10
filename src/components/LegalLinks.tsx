const links = [
  ['服务条款', '/legal/TERMS.md'], ['隐私政策', '/legal/PRIVACY.md'], ['可接受使用', '/legal/ACCEPTABLE_USE.md'], ['USDT 规则', '/legal/USDT_PAYMENT.md'], ['AI 内容责任', '/legal/AI_CONTENT.md']
] as const;

export function LegalLinks() {
  return (
    <nav aria-label="法律文件" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
      {links.map(([label, href]) => (
        <a
          key={href}
          className="hover:text-slate-800 transition-colors py-1 px-1 rounded"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
