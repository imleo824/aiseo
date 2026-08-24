import React, { useState, useMemo } from 'react';
import { WordPressSite, AutomatedTask } from '../types/seo';
import { 
  Clock, 
  Play, 
  Pause, 
  Trash2, 
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
  onDeleteTask: (taskId: string) => Promise<void>;
  onRunTaskNow: (taskId: string) => Promise<void>;
}

export const ProAutopilotTasksTab: React.FC<ProAutopilotTasksTabProps> = ({
  sites = [],
  tasks = [],
  onCreateTask,
  onToggleTask,
  onDeleteTask,
  onRunTaskNow
}) => {
  const safeSites = useMemo(() => sites || [], [sites]);
  const safeTasks = useMemo(() => tasks || [], [tasks]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Modal Form State
  const [taskName, setTaskName] = useState('');
  const [siteId, setSiteId] = useState('all');
  const [scheduleType, setScheduleType] = useState<'DAILY' | 'INTERVAL' | 'WEEKLY'>('DAILY');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [targetKeywordTopic, setTargetKeywordTopic] = useState('');
  const [articleCountPerRun, setArticleCountPerRun] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleOpenCreateModal = () => {
    setTaskName('');
    setSiteId(safeSites[0]?.id || 'all');
    setScheduleType('DAILY');
    setScheduleTime('09:00');
    setTargetKeywordTopic('');
    setArticleCountPerRun(1);
    setIsModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName.trim()) {
      showToast('请输入任务名称');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSite = safeSites.find(s => s.id === siteId);
      const siteName = siteId === 'all' ? '全部站点' : (selectedSite?.domain || '特定站点');

      await onCreateTask({
        taskName: taskName.trim(),
        siteId,
        siteName,
        scheduleType,
        scheduleTime,
        targetKeywordTopic: targetKeywordTopic.trim() || '通用行业热门词',
        articleCountPerRun,
        status: 'ACTIVE'
      });

      showToast('定时发文计划已创建！');
      setIsModalOpen(false);
    } catch {
      showToast('创建失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunNow = async (taskId: string) => {
    setRunningTaskId(taskId);
    try {
      await onRunTaskNow(taskId);
      showToast('🎉 计划任务已立即执行并发布完成！');
    } catch {
      showToast('执行异常，请稍后重试');
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleToggleStatus = async (task: AutomatedTask) => {
    try {
      await onToggleTask(task.id, task.status);
      showToast(task.status === 'ACTIVE' ? '任务已暂停' : '任务已开启');
    } catch {
      showToast('操作失败');
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await onDeleteTask(taskId);
      showToast('已删除任务');
    } catch {
      showToast('删除失败');
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

      <div className="bg-white border border-slate-200 rounded-lg p-6 sm:p-8 shadow-2xs space-y-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-md bg-emerald-500 text-white flex items-center justify-center shadow-2xs">
                <Bot className="w-4 h-4" />
              </span>
              <span>自动执行</span>
            </h2>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs sm:text-sm font-semibold transition shadow-2xs flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>新建发文计划</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>当前计划列表</span>
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md font-medium">
                共 {safeTasks.length} 个计划
              </span>
              <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md font-medium flex items-center gap-1">
                <FileText className="w-3 h-3 text-indigo-500" />
                <span>累计发文 {safeTasks.reduce((acc, t) => acc + (t.totalArticles || 0), 0)} 篇</span>
              </span>
            </div>
          </div>

          {safeTasks.length === 0 ? (
            <div className="py-12 text-center space-y-3 bg-slate-50/60 rounded-xl border border-dashed border-slate-200 px-4">
              <Bot className="w-10 h-10 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-700">暂无托管计划</div>
                <div className="text-xs text-slate-500">
                  点击上方「新建发文计划」开启自动发文。
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
                        ? 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300' 
                        : 'bg-slate-50/80 border-slate-200/60 opacity-80'
                    }`}
                  >
                    <div className="space-y-2.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                          isActive 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
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
                          <span>{
                            task.scheduleType === 'DAILY' ? `每天 ${task.scheduleTime}` :
                            task.scheduleType === 'WEEKLY' ? `每周 ${task.scheduleTime}` :
                            `每 ${task.scheduleTime} 小时`
                          }</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          <span>主题: {task.targetKeywordTopic || '行业热词'}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          <span>每次 {task.articleCountPerRun || 1} 篇</span>
                        </span>
                        <span className="flex items-center gap-1 bg-indigo-50/80 text-indigo-700 border border-indigo-100/90 px-2 py-0.5 rounded-md font-medium">
                          <FileText className="w-3.5 h-3.5 text-indigo-500" />
                          <span>累计文章: <strong className="text-indigo-950 font-bold ml-0.5">{task.totalArticles ?? 0}</strong> 篇</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
                      <button
                        type="button"
                        onClick={() => handleRunNow(task.id)}
                        disabled={isRunning}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border ${
                          isRunning 
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait' 
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 active:scale-95'
                        }`}
                      >
                        {isRunning ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
                            <span>正在生成发布...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
                            <span>立即触发一次</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStatus(task)}
                        className={`p-2 rounded-xl border text-xs transition ${
                          isActive 
                            ? 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100' 
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={isActive ? '暂停' : '开启'}
                      >
                        {isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(task.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
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
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 sticky top-0 z-10">
              <h3 className="font-bold text-slate-900 text-base">新建定时发文计划</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-xl transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4 text-sm">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-800">任务名称</label>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="例如：每日早间行业热词推送"
                  required
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-800">目标站点</label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                >
                  <option value="all">全部站点（轮询发布）</option>
                  {safeSites.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.domain})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-800">调度周期</label>
                  <select
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value as any)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                  >
                    <option value="DAILY">每天固定时间</option>
                    <option value="INTERVAL">按小时轮询</option>
                    <option value="WEEKLY">每周定时</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-slate-800">时间参数</label>
                  <input
                    type="text"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    placeholder="如 09:00 或 4"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-800">指定主题/词（可选）</label>
                <input
                  type="text"
                  value={targetKeywordTopic}
                  onChange={(e) => setTargetKeywordTopic(e.target.value)}
                  placeholder="留空则自动分析行业挖掘热词"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-slate-400"
                />
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
                  {isSubmitting ? '保存中...' : '保存任务'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
