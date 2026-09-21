import React, { useState, useMemo, useRef } from 'react';
import { WordPressSite, AutomatedTask } from '../types/seo';
import type { GrowthInput } from '../types/api';
import {
  Clock,
  Play,
  Pause,
  Plus,
  CheckCircle2,
  X,
  Bot,
  Zap,
  Globe,
  Tag,
  FileText
} from 'lucide-react';
import { useDialogInteraction } from '../hooks/useDialogInteraction';

const splitKeywords = (value: string): string[] => value
  .split(/[\n,，;；]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const normalizeInputUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return `https://${trimmed}`;
};

const splitUrls = (value: string): string[] => value
  .split(/[\s,，;；\n]+/)
  .map((item) => item.trim())
  .filter(Boolean)
  .map(normalizeInputUrl)
  .filter((url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  });

interface ProAutopilotTasksTabProps {
  sites: WordPressSite[];
  tasks: AutomatedTask[];
  onCreateTask: (task: Partial<AutomatedTask>) => Promise<void>;
  onToggleTask: (taskId: string, currentStatus: 'ACTIVE' | 'PAUSED') => Promise<void>;
  onRunTaskNow: (taskId: string) => Promise<{ success?: boolean; message?: string } | void>;
  onOpenSiteManagement?: () => void;
}

export const ProAutopilotTasksTab: React.FC<ProAutopilotTasksTabProps> = ({
  sites = [],
  tasks = [],
  onCreateTask,
  onToggleTask,
  onRunTaskNow,
  onOpenSiteManagement
}) => {
  const safeSites = useMemo(() => sites || [], [sites]);
  const safeTasks = useMemo(() => tasks || [], [tasks]);
  const eligibleSites = useMemo(() => safeSites.filter((site) => site.connectorStatus === 'CONNECTED'), [safeSites]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<'success' | 'info' | 'error'>('info');

  // Modal Form State
  const [siteId, setSiteId] = useState('');
  const [keywordInputs, setKeywordInputs] = useState('');
  const [referenceInputs, setReferenceInputs] = useState('');
  const [competitorInputs, setCompetitorInputs] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropMouseDown } = useDialogInteraction({
    open: isModalOpen,
    onClose: () => setIsModalOpen(false),
    closeDisabled: isSubmitting,
    initialFocusRef: closeButtonRef
  });

  const showToast = (msg: string, kind: 'success' | 'info' | 'error' = 'info') => {
    setToastKind(kind);
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenCreateModal = () => {
    if (!eligibleSites.length) {
      showToast('请先连接一个 WordPress 站点', 'error');
      return;
    }
    setSiteId(eligibleSites[0].id);
    setKeywordInputs('');
    setReferenceInputs('');
    setCompetitorInputs('');
    setIsModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const inputs: GrowthInput[] = [
      ...splitKeywords(keywordInputs).map((value): GrowthInput => ({ type: 'KEYWORD', value })),
      ...splitUrls(referenceInputs).map((value): GrowthInput => ({ type: 'REFERENCE_URL', value })),
      ...splitUrls(competitorInputs).map((value): GrowthInput => ({ type: 'COMPETITOR_SITE', value }))
    ];
    if (!siteId || !inputs.length) {
      showToast('请选择站点并至少填写一种线索', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSite = safeSites.find(s => s.id === siteId);
      const siteName = siteId === 'all' ? '全部站点' : (selectedSite?.domain || '特定站点');

      await onCreateTask({
        taskName: `${selectedSite?.name || selectedSite?.domain || '站点'}持续增长`,
        siteId,
        siteName,
        scheduleType: 'WEEKLY',
        scheduleTime: '系统自适应',
        targetKeywordTopic: inputs.map(({ value }) => value).join('、'),
        sourceType: inputs[0].type,
        inputs,
        articleCountPerRun: 1,
        status: 'ACTIVE'
      });

      showToast('自动计划已创建', 'success');
      setIsModalOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建失败，请重试', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunNow = async (taskId: string) => {
    setRunningTaskId(taskId);
    try {
      const result = await onRunTaskNow(taskId);
      if (result && result.success === false) {
        showToast(result.message || '本次没有完成，请查看原因', 'error');
      } else {
        showToast((result && 'message' in result ? result.message : undefined) || '计划任务已完成执行');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '执行失败，请稍后重试', 'error');
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleToggleStatus = async (task: AutomatedTask) => {
    try {
      await onToggleTask(task.id, task.status);
      showToast(task.status === 'ACTIVE' ? '计划已暂停' : '计划已开启', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', 'error');
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {toastMessage && (
        <div role={toastKind === 'error' ? 'alert' : 'status'} aria-live={toastKind === 'error' ? 'assertive' : 'polite'} className={`fixed bottom-24 left-3 right-3 z-50 text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center space-x-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-md ${toastKind === 'error' ? 'bg-rose-950 border-rose-800' : 'bg-slate-900 border-slate-700'}`}>
          <CheckCircle2 className={`w-4 h-4 ${toastKind === 'error' ? 'text-rose-300' : toastKind === 'success' ? 'text-emerald-400' : 'text-sky-300'}`} />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <span>计划列表</span>
              </h3>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                disabled={!eligibleSites.length}
                title={eligibleSites.length ? '新建自动计划' : '请先授权连接 WordPress 站点'}
                className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-[38px]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建自动计划</span>
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs self-start sm:self-auto">
              <span className="text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg font-semibold">
                共 {safeTasks.length} 个计划
              </span>
              <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-indigo-500" />
                <span>共 {safeTasks.reduce((acc, t) => acc + (t.totalArticles || 0), 0)} 次交付</span>
              </span>
            </div>
          </div>

          {safeTasks.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200/90 px-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
                <Bot className="w-6 h-6" />
              </div>
              <div className="text-sm font-bold text-slate-800">暂无自动计划</div>
              <p className="text-xs text-slate-500">连接 WordPress 后，系统会按新证据自动安排安全增长动作。</p>
              {!eligibleSites.length && onOpenSiteManagement && (
                <button type="button" onClick={onOpenSiteManagement} className="btn-primary min-h-[40px] px-4 text-xs">
                  去授权 WordPress
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {safeTasks.map((task) => {
                const isRunning = runningTaskId === task.id;
                const isActive = task.status === 'ACTIVE';

                return (
                  <div
                    key={task.id}
                    className={`p-4 sm:p-5 rounded-xl border transition-all duration-150 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                      isActive
                        ? 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                        : 'bg-slate-50/70 border-slate-200/80 opacity-85'
                    }`}
                  >
                    <div className="space-y-2.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                          <span>{isActive ? '运行中' : '已暂停'}</span>
                        </span>

                        <h4 className="font-bold text-sm sm:text-base text-slate-950 truncate">
                          {task.taskName}
                        </h4>

                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1 bg-slate-100 px-2.5 py-1 rounded-lg">
                          <Globe className="w-3 h-3 text-slate-400" />
                          <span>{task.siteName || '全部站点'}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>系统按新证据调度，新站最多每 7 天一个动作</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          <span>主题: {task.targetKeywordTopic || '按站点主题自动选题'}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          <span>每轮最多 1 个动作</span>
                        </span>
                        <span className="flex items-center gap-1 bg-indigo-50/80 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 rounded-md font-medium">
                          <FileText className="w-3.5 h-3.5 text-indigo-500" />
                          <span>已交付: <strong className="text-indigo-950 font-bold ml-0.5">{task.totalArticles ?? 0}</strong> 次</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 w-full sm:w-auto justify-end sm:justify-start">
                      <button
                        type="button"
                        onClick={() => handleRunNow(task.id)}
                        disabled={isRunning || !isActive}
                        title={isActive ? '立即创建一次真实机会检查' : '请先开启自动计划'}
                        className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border min-h-[40px] cursor-pointer ${
                          isRunning || !isActive
                            ? `bg-slate-100 text-slate-400 border-slate-200/80 ${isRunning ? 'cursor-wait' : 'cursor-not-allowed'}`
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200/90 hover:bg-emerald-100 active:scale-95'
                        }`}
                      >
                        {isRunning ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                            <span>正在检查机会...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                            <span>检查新机会</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStatus(task)}
                        className={`w-10 h-10 rounded-xl border text-xs transition flex items-center justify-center cursor-pointer ${
                          isActive
                            ? 'bg-slate-50 text-slate-600 border-slate-200/90 hover:bg-slate-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={isActive ? '暂停' : '开启'}
                        aria-label={isActive ? '暂停任务' : '开启任务'}
                      >
                        {isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {isModalOpen && (
        <div onMouseDown={onBackdropMouseDown} className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="autopilot-dialog-title" aria-busy={isSubmitting} tabIndex={-1} className="bg-white border border-slate-200/90 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 sticky top-0 z-10">
              <h3 id="autopilot-dialog-title" className="font-bold text-slate-950 text-base">新建自动计划</h3>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                aria-label="关闭窗口"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 sm:p-6 space-y-4 text-sm">
              <div className="space-y-1.5">
                <label htmlFor="autopilot-site" className="text-xs font-bold text-slate-700">目标站点</label>
                <select
                  id="autopilot-site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400 text-sm font-medium text-slate-800 transition-colors"
                >
                  {eligibleSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">关键词或主题</label>
                  <textarea value={keywordInputs} onChange={(event) => setKeywordInputs(event.target.value)} rows={2} placeholder="每行一个，可输入多个" className="w-full resize-none px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400 text-sm text-slate-800 placeholder:text-slate-400 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">参考文章链接</label>
                  <textarea value={referenceInputs} onChange={(event) => setReferenceInputs(event.target.value)} rows={2} placeholder="每行一个完整 HTTPS 地址，可不填" className="w-full resize-none px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400 text-sm text-slate-800 placeholder:text-slate-400 transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">竞品站点</label>
                  <textarea value={competitorInputs} onChange={(event) => setCompetitorInputs(event.target.value)} rows={2} placeholder="每行一个完整 HTTPS 地址，可不填" className="w-full resize-none px-3.5 py-2.5 bg-slate-50/80 border border-slate-200/90 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400 text-sm text-slate-800 placeholder:text-slate-400 transition-colors" />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">可填写一种或多种，系统会自动分析并选择下一步。</p>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5 text-xs leading-5 text-indigo-950 font-medium">
                无需设置时间。系统发现合适机会时自动执行；没有机会就不操作、不扣费。
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 active:bg-slate-200 rounded-xl transition min-h-[44px] cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm rounded-xl font-bold transition shadow-2xs min-h-[44px] cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? '正在启动…' : '创建计划'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
