import React from 'react';
import { Swords } from 'lucide-react';

interface CompetitorAnalysisSectionProps {
  competitorInput: string;
  onCompetitorInputChange: (val: string) => void;
}

export const CompetitorAnalysisSection: React.FC<CompetitorAnalysisSectionProps> = ({
  competitorInput,
  onCompetitorInputChange
}) => {
  return (
    <div className="space-y-3 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/60">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="font-semibold text-slate-700 flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-slate-600" />
          输入竞品网站 URL
        </span>
      </div>

      <div className="relative">
          <input
            type="url"
            value={competitorInput}
            onChange={(e) => onCompetitorInputChange(e.target.value)}
            placeholder="粘贴竞品 HTTPS 页面（如 https://competitor.com/product/）"
            className="w-full px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs pr-12"
          />
          {competitorInput && (
            <button
              type="button"
              onClick={() => onCompetitorInputChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md"
            >
              清空
            </button>
          )}
      </div>
      <p className="text-[11px] text-slate-500">系统会抓取该页面、提炼非品牌搜索意图，再使用 DataForSEO 验证真实需求与竞争度。</p>
    </div>
  );
};
