import React from 'react';
import { ArticleDraft } from '../../types/seo';
import { CheckCircle2, X, RotateCcw } from 'lucide-react';
import { SafeArticleContent } from '../SafeArticleContent';

interface DraftPreviewModalProps {
  draft: ArticleDraft | null;
  onClose: () => void;
  onRollback?: (draftId: string) => Promise<void>;
}

export const DraftPreviewModal: React.FC<DraftPreviewModalProps> = ({
  draft,
  onClose,
  onRollback
}) => {
  if (!draft) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200/90 rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="min-w-0 pr-3">
            <div className={`text-xs font-bold flex items-center gap-1.5 ${draft.qualityGate ? 'text-emerald-700' : 'text-slate-600'}`}>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{draft.qualityGate ? `质量评分: ${draft.qualityGate.overallScore} 分` : '尚无可验证的质量报告'}</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base truncate mt-0.5">{draft.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
            aria-label="关闭详情预览"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          <div className="space-y-1 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 text-sm">
            <div className="text-slate-500 font-bold text-xs uppercase tracking-wider">核心摘要</div>
            <div className="text-slate-800 text-xs sm:text-sm leading-relaxed">{draft.summary}</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">正文内容</div>
            <SafeArticleContent
              className="prose prose-slate max-w-none bg-slate-50/50 p-4 sm:p-5 rounded-xl border border-slate-200/80 text-xs sm:text-sm leading-relaxed"
              html={draft.contentHtml || draft.summary}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 gap-3">
          {draft.status === 'PUBLISHED' && onRollback ? (
            <button
              type="button"
              onClick={() => onRollback(draft.id)}
              className="px-4 py-2 text-xs text-rose-600 hover:bg-rose-50 active:bg-rose-100 border border-rose-200/90 rounded-xl transition flex items-center gap-1.5 font-bold min-h-[40px] cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>下线文章</span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-950 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 active:bg-slate-900 transition min-h-[40px] shadow-xs cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
