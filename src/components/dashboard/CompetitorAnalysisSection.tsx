import React from 'react';
import { CompetitorAttackAnalysis } from '../../types/seo';
import { Search, RefreshCw, ArrowRight, Swords, Sparkles, Check, X } from 'lucide-react';

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
    <div className="space-y-3 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/60">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="font-semibold text-slate-700 flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-slate-600" />
          输入竞品网站 URL
        </span>
      </div>

      <div className="relative flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={competitorInput}
            onChange={(e) => onCompetitorInputChange(e.target.value)}
            placeholder="粘贴竞品网址 (如 https://notion.so/blog/...) "
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

        <button
          type="button"
          onClick={onAnalyze}
          disabled={isAnalyzing || !competitorInput.trim()}
          title="可选：提前提炼多维度攻击视角词"
          className="w-full sm:w-auto px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200/80 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-semibold border border-slate-200 transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
        >
          {isAnalyzing ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-600" /> : <Sparkles className="w-3.5 h-3.5 text-amber-500" />}
          <span>{isAnalyzing ? '分析中...' : '提炼切入词(可选)'}</span>
        </button>
      </div>


      {competitorAnalysis && (
        <div className="pt-2 space-y-2 border-t border-slate-200/70 mt-3 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-800 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              提炼的精细进攻词（点击可指定视角生成）：
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {competitorAnalysis.attackKeywords.map((kw, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectAttackKeyword(kw.keyword)}
                disabled={isRunning}
                className="p-2.5 bg-white hover:bg-slate-100/80 border border-slate-200/80 rounded-xl text-left transition flex items-center justify-between group cursor-pointer shadow-2xs active:scale-[0.99]"
              >
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60">
                    {kw.typeLabel}
                  </span>
                  <div className="text-xs font-bold text-slate-900 mt-1 truncate">{kw.keyword}</div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 group-hover:text-slate-900 group-hover:translate-x-0.5 transition" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

