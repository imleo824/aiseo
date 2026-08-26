import React, { useState, useMemo } from 'react';
import { ArticleDraft, WordPressSite } from '../../types/seo';
import { 
  Globe, 
  Search, 
  Check, 
  Eye, 
  Share2, 
  CheckCircle2, 
  ExternalLink, 
  X
} from 'lucide-react';
import { SafeArticleContent } from '../SafeArticleContent';

interface RecentRecordsListProps {
  drafts?: ArticleDraft[];
  sites?: WordPressSite[];
  onPreviewDraft?: (draft: ArticleDraft) => void;
  onRePushIndexing?: (draftId: string) => Promise<void>;
}

export const RecentRecordsList: React.FC<RecentRecordsListProps> = ({ 
  drafts = [],
  sites = [],
  onPreviewDraft,
  onRePushIndexing
}) => {
  const safeDrafts = drafts || [];
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');
  const [pushingDraftId, setPushingDraftId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeDraftModal, setActiveDraftModal] = useState<ArticleDraft | null>(null);

  const showLocalToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const getSiteName = (siteId: string) => {
    const s = sites.find(item => item.id === siteId);
    return s?.name || '默认站点';
  };

  const handlePush = async (draftId: string) => {
    setPushingDraftId(draftId);
    try {
      if (onRePushIndexing) {
        await onRePushIndexing(draftId);
      } else {
        showLocalToast('收录推送执行器未连接，未提交任何请求。');
        return;
      }
      showLocalToast('已重新向搜索引擎推送收录请求');
    } catch {
      showLocalToast('收录推送失败，未确认提交成功。');
    } finally {
      setPushingDraftId(null);
    }
  };

  const filteredDrafts = useMemo(() => {
    return safeDrafts.filter(d => {
      const matchesSearch = !searchQuery.trim() || 
        d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.category && d.category.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesStatus = statusFilter === 'ALL' || 
        (statusFilter === 'PUBLISHED' && d.status === 'PUBLISHED') ||
        (statusFilter === 'DRAFT' && d.status !== 'PUBLISHED');

      return matchesSearch && matchesStatus;
    });
  }, [safeDrafts, searchQuery, statusFilter]);

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
      
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-md shadow-xl flex items-center space-x-2 text-sm font-medium animate-in fade-in slide-in-from-top-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header with Search and Filter */}
      <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Search & Status Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search Input */}
          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文章标题..."
              className="w-full pl-9 pr-3.5 py-2 bg-white border border-slate-200 rounded-md text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition"
            />
          </div>

          {/* Status Filter */}
          <div className="inline-flex p-1 bg-slate-100 rounded-md border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded transition cursor-pointer ${
                statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setStatusFilter('PUBLISHED')}
              className={`px-3 py-1.5 rounded transition cursor-pointer ${
                statusFilter === 'PUBLISHED' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              已上线
            </button>
            <button
              onClick={() => setStatusFilter('DRAFT')}
              className={`px-3 py-1.5 rounded transition cursor-pointer ${
                statusFilter === 'DRAFT' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              草稿
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Card-List View (Shown on mobile, hidden on desktop) */}
      <div className="block md:hidden space-y-3.5 p-4">
        {filteredDrafts.map((draft) => {
          const siteName = getSiteName(draft.siteId);
          const isPublished = draft.status === 'PUBLISHED';
          const score = draft.qualityGate?.overallScore || 96;
          const isPushing = pushingDraftId === draft.id;

          return (
            <div 
              key={draft.id} 
              className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-3 hover:border-slate-300 transition"
            >
              <div className="space-y-1.5">
                <div 
                  onClick={() => {
                    if (onPreviewDraft) onPreviewDraft(draft);
                    else setActiveDraftModal(draft);
                  }}
                  className="font-bold text-slate-900 text-sm active:text-indigo-600 cursor-pointer hover:underline line-clamp-2"
                >
                  {draft.title}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded font-medium">{draft.category || 'SEO 文章'}</span>
                  {draft.wordCount && <span>· {draft.wordCount} 字</span>}
                  <span>· {draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString() : '刚刚'}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    <Globe className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate max-w-[120px]">{siteName}</span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 font-bold text-[10px]">
                    {score}分
                  </span>
                  {isPublished ? (
                    <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold">
                      已上线
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px]">
                      草稿
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-100/60">
                {isPublished && draft.publishedUrl && (
                  <a
                    href={draft.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>访问</span>
                  </a>
                )}

                <button
                  onClick={() => {
                    if (onPreviewDraft) onPreviewDraft(draft);
                    else setActiveDraftModal(draft);
                  }}
                  className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  <span>预览</span>
                </button>

                {isPublished && (
                  <button
                    onClick={() => handlePush(draft.id)}
                    disabled={isPushing}
                    className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-medium transition flex items-center gap-1 disabled:opacity-50"
                  >
                    <Share2 className={`w-3 h-3 ${isPushing ? 'animate-spin' : ''}`} />
                    <span>推送</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Table (Hidden on mobile, shown on desktop) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-slate-500 border-b border-slate-100 select-none text-xs">
            <tr>
              <th className="px-6 py-3.5 font-bold">文章标题</th>
              <th className="px-4 py-3.5 font-bold">站点</th>
              <th className="px-4 py-3.5 font-bold text-center">质量分</th>
              <th className="px-4 py-3.5 font-bold text-center">状态</th>
              <th className="px-4 py-3.5 font-bold">发布日期</th>
              <th className="px-6 py-3.5 font-bold text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredDrafts.map((draft) => {
              const siteName = getSiteName(draft.siteId);
              const isPublished = draft.status === 'PUBLISHED';
              const score = draft.qualityGate?.overallScore || 96;
              const isPushing = pushingDraftId === draft.id;

              return (
                <tr key={draft.id} className="hover:bg-slate-50/60 transition">
                  
                  {/* Title */}
                  <td className="px-6 py-4">
                    <div 
                      onClick={() => {
                        if (onPreviewDraft) onPreviewDraft(draft);
                        else setActiveDraftModal(draft);
                      }}
                      className="font-semibold text-slate-900 text-sm sm:text-base hover:text-indigo-600 cursor-pointer line-clamp-1 max-w-xl xl:max-w-3xl"
                    >
                      {draft.title}
                    </div>
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                      <span>{draft.category || 'SEO 文章'}</span>
                      {draft.wordCount && <span>· {draft.wordCount} 字</span>}
                    </div>
                  </td>

                  {/* Target Site */}
                  <td className="px-4 py-4 text-slate-700 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                      <Globe className="w-3.5 h-3.5 text-slate-400" />
                      <span>{siteName}</span>
                    </span>
                  </td>

                  {/* Quality Score */}
                  <td className="px-4 py-4 text-center whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-xs">
                      {score} 分
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-4 text-center whitespace-nowrap">
                    {isPublished ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
                        <Check className="w-3 h-3" />
                        已上线
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                        草稿
                      </span>
                    )}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-4 text-slate-500 text-xs whitespace-nowrap">
                    {draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString() : '刚刚'}
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {isPublished && draft.publishedUrl && (
                        <a
                          href={draft.publishedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>访问</span>
                        </a>
                      )}

                      <button
                        onClick={() => {
                          if (onPreviewDraft) onPreviewDraft(draft);
                          else setActiveDraftModal(draft);
                        }}
                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium transition flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>预览</span>
                      </button>

                      {isPublished && (
                        <button
                          onClick={() => handlePush(draft.id)}
                          disabled={isPushing}
                          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-medium transition flex items-center gap-1 disabled:opacity-50"
                        >
                          <Share2 className={`w-3.5 h-3.5 ${isPushing ? 'animate-spin' : ''}`} />
                          <span>推送</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Preview */}
      {activeDraftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="min-w-0 pr-3">
                <h3 className="font-bold text-slate-900 text-base truncate">{activeDraftModal.title}</h3>
                <div className="text-xs text-slate-500 mt-0.5">质量评分: {activeDraftModal.qualityGate?.overallScore || 96} 分</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDraftModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              <div className="space-y-1 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-sm">
                <div className="text-slate-500 font-medium">核心摘要：</div>
                <div className="text-slate-800">{activeDraftModal.summary}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-bold text-slate-800">正文内容：</div>
                <SafeArticleContent
                  className="prose prose-slate max-w-none bg-slate-50/50 p-5 rounded-2xl border border-slate-200/80 text-sm leading-relaxed"
                  html={activeDraftModal.contentHtml || activeDraftModal.summary}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end bg-slate-50/50">
              <button
                type="button"
                onClick={() => setActiveDraftModal(null)}
                className="px-5 py-2 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
