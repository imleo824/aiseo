import React from 'react';
import { CompetitorAttackAnalysis } from '../../types/seo';
import { Search, RefreshCw, Zap } from 'lucide-react';

interface CompetitorAnalysisSectionProps {
  competitorInput: string;
  onCompetitorInputChange: (val: string) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  competitorAnalysis: CompetitorAttackAnalysis | null;
  onSelectAttackKeyword: (keyword: string) => void;
  isRunning: boolean;
}

export const CompetitorAnalysisSection: React.FC<CompetitorAnalysisSectionProps> = ({
  competitorInput,
  onCompetitorInputChange,
  onAnalyze,
  isAnalyzing,
  competitorAnalysis,
  onSelectAttackKeyword,
  isRunning
}) => {
  return (
    <div className="p-4 sm:p-5 rounded-xl bg-slate-50/60 border border-slate-200 space-y-3 animate-in fade-in duration-150">
      <div className="text-xs text-slate-600">
        输入竞品网址，系统将自动分析其薄弱点并直接生成截流文章：
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={competitorInput}
          onChange={(e) => onCompetitorInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAnalyze();
          }}
          placeholder="输入竞品域名/文章链接 (如 https://notion.so/blog/...)"
          className="flex-1 px-4 py-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-slate-400"
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isAnalyzing || !competitorInput.trim()}
          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
        >
          {isAnalyzing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span>提炼对标词</span>
        </button>
      </div>

      {competitorAnalysis && (
        <div className="pt-2 space-y-2">
          <div className="text-xs font-bold text-slate-800">点击下方进攻词立即生成并发布：</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {competitorAnalysis.attackKeywords.map((kw, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectAttackKeyword(kw.keyword)}
                disabled={isRunning}
                className="p-3 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl text-left transition flex items-center justify-between group cursor-pointer"
              >
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                    {kw.typeLabel}
                  </span>
                  <div className="text-xs font-bold text-slate-900 mt-1 truncate">{kw.keyword}</div>
                </div>
                <Zap className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0 group-hover:scale-110 transition" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
