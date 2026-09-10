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
  onApprovePublish?: (draftId: string) => Promise<void>;
  onRePushIndexing?: (draftId: string) => Promise<void>;
}

export const RecentRecordsList: React.FC<RecentRecordsListProps> = ({
  drafts = [],
  sites = [],
  onPreviewDraft,
  onApprovePublish,
  onRePushIndexing
}) => {
  const safeDrafts = drafts || [];
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');
  const [pushingDraftId, setPushingDraftId] = useState<string | null>(null);
  const [publishingDraftId, setPublishingDraftId] = useState<string | null>(null);
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
      showLocalToast('已创建收录监测请求；普通文章将通过站点地图与 GSC 跟踪发现状态');
    } catch {
      showLocalToast('收录推送失败，未确认提交成功。');
    } finally {
      setPushingDraftId(null);
    }
  };

  const handleApprovePublish = async (draftId: string) => {
    if (!onApprovePublish) return;
    setPublishingDraftId(draftId);
    try {
      await onApprovePublish(draftId);
      setActiveDraftModal(null);
      showLocalToast('审核通过，文章已发布到 WordPress');
    } catch (error) {
      showLocalToast(error instanceof Error ? error.message : '审核发布失败');
    } finally {
      setPublishingDraftId(null);
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
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search & Status Filter */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文章标题或分类..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50/80 hover:bg-slate-100/60 focus:bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition-colors shadow-2xs min-h-[40px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-md cursor-pointer"
                aria-label="清空搜索"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-[34px] ${
                statusFilter === 'ALL' ? 'bg-white text-slate-950 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PUBLISHED')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-[34px] ${
                statusFilter === 'PUBLISHED' ? 'bg-white text-slate-950 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              已上线
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('DRAFT')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer min-h-[34px] ${
                statusFilter === 'DRAFT' ? 'bg-white text-slate-950 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              草稿
            </button>
          </div>
        </div>
      </div>

      {filteredDrafts.length === 0 ? (
        <div className="p-10 sm:p-14 text-center space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
            <Search className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-900">
              {safeDrafts.length === 0 ? '暂无内容交付记录' : '未匹配到相关内容'}
            </h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {safeDrafts.length === 0
                ? '在上方启动增长任务或自动执行程序，生成的文章草稿与上线记录将实时呈现在此处。'
                : '请尝试更换搜索关键词或清除状态筛选条件。'}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile Card-List View (Shown on mobile, hidden on desktop) */}
          <div className="block md:hidden space-y-3 p-3.5 sm:p-4">
            {filteredDrafts.map((draft) => {
              const siteName = getSiteName(draft.siteId);
              const isPublished = draft.status === 'PUBLISHED';
              const score = draft.qualityGate?.overallScore;
              const isPushing = pushingDraftId === draft.id;

              return (
                <div
                  key={draft.id}
                  className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs space-y-3 hover:border-slate-300 transition-colors"
                >
                  <div className="space-y-1.5">
                    <div
                      onClick={() => {
                        if (onPreviewDraft) onPreviewDraft(draft);
                        else setActiveDraftModal(draft);
                      }}
                      className="font-bold text-slate-950 text-sm active:text-indigo-600 cursor-pointer hover:underline line-clamp-2 leading-snug"
                    >
                      {draft.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold">{draft.category || 'SEO 文章'}</span>
                      {draft.wordCount && <span>· {draft.wordCount} 字</span>}
                      <span>· {draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString() : '刚刚'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 flex-wrap">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md font-medium">
                        <Globe className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[120px]">{siteName}</span>
                      </span>
                      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border font-bold text-[10px] ${score === undefined ? 'bg-slate-50 text-slate-600 border-slate-200/90' : 'bg-emerald-50 text-emerald-700 border-emerald-200/90'}`}>
                        {score === undefined ? '未质检' : `${score}分`}
                      </span>
                      {isPublished ? (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[10px] font-bold">
                          已上线
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-semibold">
                          草稿
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100/80">
                    {isPublished && draft.publishedUrl && (
                      <a
                        href={draft.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1 min-h-[38px]"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                        <span>访问</span>
                      </a>
                    )}

                    {!isPublished && draft.status === 'PENDING_APPROVAL' && onApprovePublish && (
                      <button
                        type="button"
                        onClick={() => void handleApprovePublish(draft.id)}
                        disabled={publishingDraftId === draft.id}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 min-h-[38px] shadow-2xs cursor-pointer"
                      >
                        {publishingDraftId === draft.id ? '发布中…' : '审核并发布'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (onPreviewDraft) onPreviewDraft(draft);
                        else setActiveDraftModal(draft);
                      }}
                      className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs min-h-[38px] cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-300" />
                      <span>预览</span>
                    </button>

                    {isPublished && (
                      <button
                        type="button"
                        onClick={() => handlePush(draft.id)}
                        disabled={isPushing}
                        className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border border-emerald-200/90 rounded-xl text-xs font-semibold transition flex items-center gap-1 disabled:opacity-50 min-h-[38px] cursor-pointer"
                      >
                        <Share2 className={`w-3.5 h-3.5 text-emerald-600 ${isPushing ? 'animate-spin' : ''}`} />
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
                  const score = draft.qualityGate?.overallScore;
                  const isPushing = pushingDraftId === draft.id;

                  return (
                    <tr key={draft.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Title */}
                      <td className="px-6 py-4">
                        <div
                          onClick={() => {
                            if (onPreviewDraft) onPreviewDraft(draft);
                            else setActiveDraftModal(draft);
                          }}
                          className="font-bold text-slate-900 text-sm sm:text-base hover:text-indigo-600 cursor-pointer line-clamp-1 max-w-xl xl:max-w-3xl transition-colors"
                        >
                          {draft.title}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                          <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">{draft.category || 'SEO 文章'}</span>
                          {draft.wordCount && <span>· {draft.wordCount} 字</span>}
                        </div>
                      </td>

                      {/* Target Site */}
                      <td className="px-4 py-4 text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg font-medium">
                          <Globe className="w-3.5 h-3.5 text-slate-400" />
                          <span>{siteName}</span>
                        </span>
                      </td>

                      {/* Quality Score */}
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border font-bold text-xs ${score === undefined ? 'bg-slate-50 text-slate-600 border-slate-200/90' : 'bg-emerald-50 text-emerald-700 border-emerald-200/90'}`}>
                          {score === undefined ? '未质检' : `${score} 分`}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4 text-center whitespace-nowrap">
                        {isPublished ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-xs font-bold">
                            <Check className="w-3 h-3" />
                            已上线
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-medium">
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
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1 min-h-[34px]"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                              <span>访问</span>
                            </a>
                          )}

                          {!isPublished && draft.status === 'PENDING_APPROVAL' && onApprovePublish && (
                            <button
                              type="button"
                              onClick={() => void handleApprovePublish(draft.id)}
                              disabled={publishingDraftId === draft.id}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 min-h-[34px] shadow-2xs cursor-pointer"
                            >
                              {publishingDraftId === draft.id ? '发布中…' : '审核并发布'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (onPreviewDraft) onPreviewDraft(draft);
                              else setActiveDraftModal(draft);
                            }}
                            className="px-3.5 py-1.5 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs min-h-[34px] cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-300" />
                            <span>预览</span>
                          </button>

                          {isPublished && (
                            <button
                              type="button"
                              onClick={() => handlePush(draft.id)}
                              disabled={isPushing}
                              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-800 border border-emerald-200/90 rounded-xl text-xs font-semibold transition flex items-center gap-1 disabled:opacity-50 min-h-[34px] cursor-pointer"
                            >
                              <Share2 className={`w-3.5 h-3.5 text-emerald-600 ${isPushing ? 'animate-spin' : ''}`} />
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
        </>
      )}

      {/* Modal Preview */}
      {activeDraftModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200/90 rounded-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="min-w-0 pr-3">
                <h3 className="font-bold text-slate-900 text-base truncate">{activeDraftModal.title}</h3>
                <div className="text-xs text-slate-500 mt-0.5">{activeDraftModal.qualityGate ? `质量评分: ${activeDraftModal.qualityGate.overallScore} 分` : '尚无可验证的质量报告'}</div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDraftModal(null)}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-200/60 transition cursor-pointer"
                aria-label="关闭预览"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              <div className="space-y-1 bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 text-sm">
                <div className="text-slate-500 font-bold text-xs uppercase tracking-wider">核心摘要</div>
                <div className="text-slate-800 text-xs sm:text-sm leading-relaxed">{activeDraftModal.summary}</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">正文内容</div>
                <SafeArticleContent
                  className="prose prose-slate max-w-none bg-slate-50/50 p-4 sm:p-5 rounded-xl border border-slate-200/80 text-xs sm:text-sm leading-relaxed"
                  html={activeDraftModal.contentHtml || activeDraftModal.summary}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2.5 bg-slate-50/50">
              {activeDraftModal.status === 'PENDING_APPROVAL' && onApprovePublish && (
                <button
                  type="button"
                  onClick={() => void handleApprovePublish(activeDraftModal.id)}
                  disabled={publishingDraftId === activeDraftModal.id}
                  className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-emerald-700 active:bg-emerald-800 transition disabled:opacity-50 min-h-[40px] shadow-xs cursor-pointer"
                >
                  {publishingDraftId === activeDraftModal.id ? '正在发布…' : '审核通过并发布'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveDraftModal(null)}
                className="px-5 py-2.5 bg-slate-950 text-white rounded-xl text-xs sm:text-sm font-bold hover:bg-slate-800 active:bg-slate-900 transition min-h-[40px] shadow-xs cursor-pointer"
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
