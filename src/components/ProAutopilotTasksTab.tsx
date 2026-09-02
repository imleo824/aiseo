import React, { useState, useMemo } from 'react';
import { WordPressSite, AutomatedTask } from '../types/seo';
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

interface ProAutopilotTasksTabProps {
  sites: WordPressSite[];
  tasks: AutomatedTask[];
  onCreateTask: (task: Partial<AutomatedTask>) => Promise<void>;
  onToggleTask: (taskId: string, currentStatus: 'ACTIVE' | 'PAUSED') => Promise<void>;
  onRunTaskNow: (taskId: string) => Promise<{ success?: boolean; message?: string } | void>;
}

export const ProAutopilotTasksTab: React.FC<ProAutopilotTasksTabProps> = ({
  sites = [],
  tasks = [],
  onCreateTask,
  onToggleTask,
  onRunTaskNow
}) => {
  const safeSites = useMemo(() => sites || [], [sites]);
  const safeTasks = useMemo(() => tasks || [], [tasks]);
  const eligibleSites = useMemo(() => safeSites.filter((site) => site.connectorStatus === 'CONNECTED'), [safeSites]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal Form State
  const [siteId, setSiteId] = useState('');
  const [targetKeywordTopic, setTargetKeywordTopic] = useState('');
  const [sourceType, setSourceType] = useState<'KEYWORD' | 'REFERENCE_URL' | 'COMPETITOR_SITE'>('KEYWORD');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenCreateModal = () => {
    if (!eligibleSites.length) {
      showToast('请先授权连接一个 WordPress 站点');
      return;
    }
    setSiteId(eligibleSites[0].id);
    setTargetKeywordTopic('');
    setSourceType('KEYWORD');
    setIsModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId || !targetKeywordTopic.trim()) {
      showToast('请选择站点并输入增长线索');
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
        targetKeywordTopic: targetKeywordTopic.trim(),
        sourceType,
        articleCountPerRun: 1,
        status: 'ACTIVE'
      });

      showToast('持续增长程序已创建');
      setIsModalOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunNow = async (taskId: string) => {
    setRunningTaskId(taskId);
    try {
      const result = await onRunTaskNow(taskId);
      if (result && result.success === false) {
        showToast(result.message || '任务未完成发布，请查看审计日志');
      } else {
        showToast((result && 'message' in result ? result.message : undefined) || '计划任务已完成执行');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '执行异常，请稍后重试');
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleToggleStatus = async (task: AutomatedTask) => {
    try {
      await onToggleTask(task.id, task.status);
      showToast(task.status === 'ACTIVE' ? '任务已暂停' : '任务已开启');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-xl flex items-center space-x-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100/60 pb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                <span>计划列表</span>
              </h3>
              <button
                type="button"
                onClick={handleOpenCreateModal}
                disabled={!eligibleSites.length}
                title={eligibleSites.length ? '新建持续增长程序' : '请先授权连接 WordPress 站点'}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-all shadow-xs flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建持续增长</span>
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs self-start sm:self-auto">
              <span className="text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md font-medium">
                共 {safeTasks.length} 个计划
              </span>
              <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md font-medium flex items-center gap-1">
                <FileText className="w-3 h-3 text-indigo-500" />
                <span>共 {safeTasks.reduce((acc, t) => acc + (t.totalArticles || 0), 0)} 篇</span>
              </span>
            </div>
          </div>

          {safeTasks.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-slate-50/60 rounded-xl border border-dashed border-slate-200/80 px-4">
              <Bot className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-700">暂无持续增长程序</div>
                <div className="text-xs text-slate-500">
                  连接站点并提供一个增长线索，系统会根据新证据选择下一项 SEO 动作。
                </div>
              </div>
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
                        ? 'bg-white border-slate-200/80/90 shadow-sm hover:border-slate-300'
                        : 'bg-slate-50/80 border-slate-200/80/60 opacity-80'
                    }`}
                  >
                    <div className="space-y-2.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200/80'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
                          <span>{isActive ? '运行中' : '已暂停'}</span>
                        </span>

                        <h4 className="font-bold text-sm sm:text-base text-slate-900 truncate">
                          {task.taskName}
                        </h4>

                        <span className="text-xs text-slate-500 flex items-center gap-1 bg-slate-100 px-2.5 py-0.5 rounded-lg">
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
                        <span className="flex items-center gap-1 bg-indigo-50/80 text-indigo-700 border border-indigo-100/90 px-2 py-0.5 rounded-md font-medium">
                          <FileText className="w-3.5 h-3.5 text-indigo-500" />
                          <span>已交付: <strong className="text-indigo-950 font-bold ml-0.5">{task.totalArticles ?? 0}</strong> 次</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 w-full sm:w-auto justify-end sm:justify-start">
                      <button
                        type="button"
                        onClick={() => handleRunNow(task.id)}
                        disabled={isRunning}
                        className={`flex-1 sm:flex-initial px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 border ${
                          isRunning
                            ? 'bg-slate-100 text-slate-400 border-slate-200/80 cursor-wait'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 active:scale-95'
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
                        className={`p-2 rounded-xl border text-xs transition ${
                          isActive
                            ? 'bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-slate-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={isActive ? '暂停' : '开启'}
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
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200/80 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 sticky top-0 z-10">
              <h3 className="font-bold text-slate-900 text-base">新建持续增长程序</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-4 sm:p-6 space-y-4 text-sm">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-800">目标站点</label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                >
                  {eligibleSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-800">执行来源</label>
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400">
                    <option value="KEYWORD">关键词</option>
                    <option value="REFERENCE_URL">参考文章链接</option>
                    <option value="COMPETITOR_SITE">竞品站点</option>
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="font-bold text-slate-800">执行目标</label>
                <input
                  type={sourceType === 'KEYWORD' ? 'text' : 'url'}
                  value={targetKeywordTopic}
                  onChange={(e) => setTargetKeywordTopic(e.target.value)}
                  placeholder={sourceType === 'KEYWORD' ? '输入核心关键词或主题' : '输入完整 HTTPS 地址'}
                  required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                />
                </div>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-5 text-indigo-900">
                无需设置执行时间。系统只在发现新的、可验证的机会时安排动作；没有合格机会会跳过本轮且不扣费。
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition"
                >
                  {isSubmitting ? '启动中...' : '启动持续增长'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
