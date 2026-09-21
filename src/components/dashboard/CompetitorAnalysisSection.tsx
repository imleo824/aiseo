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
    <div className="space-y-3 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/90 shadow-2xs">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="font-semibold text-slate-700 flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-slate-600" />
          <span>输入竞品网站 URL</span>
        </span>
      </div>

      <div className="relative">
        <textarea
          aria-label="竞品网站地址，每行一个"
          value={competitorInput}
          onChange={(e) => onCompetitorInputChange(e.target.value)}
          placeholder={'每行一个竞品站点，例如：\nhttps://competitor-a.com\nhttps://competitor-b.com'}
          rows={3}
          className="w-full resize-none px-3.5 py-2.5 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs pr-14"
        />
        {competitorInput && (
          <button
            type="button"
            onClick={() => onCompetitorInputChange('')}
            aria-label="清空竞品网站地址"
            className="absolute right-1.5 top-1.5 min-h-[36px] min-w-[44px] text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-lg cursor-pointer"
          >
            清空
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 font-medium">
        系统会自动分析竞品内容，并寻找适合您网站的机会。
      </p>
    </div>
  );
};
