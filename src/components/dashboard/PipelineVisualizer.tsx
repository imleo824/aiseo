import React from 'react';
import { 
  Check, 
  Terminal as TerminalIcon, 
  Search, 
  Sparkles, 
  FileText, 
  Send, 
  Share2, 
  ChevronDown,
  ChevronUp, 
} from 'lucide-react';

interface PipelineStep {
  num: number;
  title: string;
  icon: React.ReactNode;
}

interface PipelineVisualizerProps {
  activePipelineStep: number | null;
  executionLogs: string[];
}

export const PipelineVisualizer: React.FC<PipelineVisualizerProps> = ({
  activePipelineStep,
  executionLogs
}) => {
  const [showLogs, setShowLogs] = React.useState<boolean>(true);

  const pipelineSteps: PipelineStep[] = [
    { num: 1, title: '意图挖掘', icon: <Search className="w-4 h-4" /> },
    { num: 2, title: '大纲生成', icon: <Sparkles className="w-4 h-4" /> },
    { num: 3, title: '生成与质检', icon: <FileText className="w-4 h-4" /> },
    { num: 4, title: '自动发布', icon: <Send className="w-4 h-4" /> },
    { num: 5, title: '收录推送', icon: <Share2 className="w-4 h-4" /> }
  ];

  const isRunning = activePipelineStep !== null;

  return (
    <div className="space-y-4 pt-1">
      
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
        {pipelineSteps.map((s) => {
          const isActive = activePipelineStep === s.num;
          const isCompleted = activePipelineStep !== null && activePipelineStep > s.num;

          return (
            <div
              key={s.num}
              className={`p-3 sm:p-3.5 rounded-xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-emerald-500/30'
                  : isCompleted
                  ? 'bg-emerald-50/90 text-emerald-950 border-emerald-200 shadow-sm'
                  : 'bg-slate-50/80 text-slate-600 border-slate-200/80'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                isActive 
                  ? 'bg-slate-800 text-emerald-400' 
                  : isCompleted 
                  ? 'bg-emerald-100 text-emerald-700' 
                  : 'bg-white text-slate-400 border border-slate-200/80'
              }`}>
                {isCompleted ? (
                  <Check className="w-4 h-4 stroke-[3]" />
                ) : isActive ? (
                  <div className="relative flex items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-emerald-400 opacity-60"></span>
                    <span className="relative">{s.icon}</span>
                  </div>
                ) : (
                  s.icon
                )}
              </div>

              <div className="space-y-0.5">
                <div className={`font-semibold text-xs sm:text-sm ${
                  isActive ? 'text-white' : isCompleted ? 'text-emerald-900' : 'text-slate-700'
                }`}>
                  {s.title}
                </div>
                <div className={`text-[11px] font-mono ${
                  isActive ? 'text-emerald-400 font-bold' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                }`}>
                  {isCompleted ? '已完成' : isActive ? '执行中' : `步骤 ${s.num}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Terminal Log Stream */}
      {executionLogs.length > 0 && (
        <div className="bg-slate-950 text-slate-200 font-mono text-xs sm:text-sm rounded-xl overflow-hidden border border-slate-800 shadow-lg">
          <div 
            onClick={() => setShowLogs(!showLogs)}
            className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5">
              <TerminalIcon className="w-4 h-4 text-emerald-400" />
              <span className="font-semibold text-slate-200">流水线执行日志</span>
              {isRunning && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 text-xs font-semibold animate-pulse">
                  运行中
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <span>{executionLogs.length} 条记录</span>
              {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>

          {showLogs && (
            <div className="p-4 space-y-2 max-h-56 overflow-y-auto font-mono text-xs leading-relaxed">
              {executionLogs.map((log, idx) => {
                const timeStr = log.slice(0, 10);
                const rest = log.slice(10);
                const isError = rest.includes('[异常]') || rest.includes('失败');
                const isPush = rest.includes('[提交收录]') || rest.includes('收录');
                const isDeploy = rest.includes('[站点发布]') || rest.includes('WordPress');
                const isWrite = rest.includes('[智能撰写]') || rest.includes('[内容质检]');
                const isIntent = rest.includes('[关键词') || rest.includes('[站点分析');

                let badgeColor = 'text-slate-300';
                if (isError) badgeColor = 'text-rose-400 font-bold';
                else if (isPush) badgeColor = 'text-amber-400 font-semibold';
                else if (isDeploy) badgeColor = 'text-sky-400 font-semibold';
                else if (isWrite) badgeColor = 'text-purple-400 font-semibold';
                else if (isIntent) badgeColor = 'text-emerald-400 font-semibold';

                return (
                  <div key={idx} className="flex items-start gap-2.5">
                    <span className="text-slate-500 select-none shrink-0 font-medium">{timeStr}</span>
                    <span className={badgeColor}>{rest}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
};
