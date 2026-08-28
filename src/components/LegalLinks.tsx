const links = [
  ['服务条款', '/legal/TERMS.md'], ['隐私政策', '/legal/PRIVACY.md'], ['可接受使用', '/legal/ACCEPTABLE_USE.md'], ['USDT 规则', '/legal/USDT_PAYMENT.md'], ['AI 内容责任', '/legal/AI_CONTENT.md']
] as const;

export function LegalLinks() {
  return <nav aria-label="法律文件" className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-500">{links.map(([label, href]) => <a key={href} className="hover:text-slate-300" href={href} target="_blank" rel="noreferrer">{label}</a>)}</nav>;
}
