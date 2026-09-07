import React from 'react';
import { AUTOMATION_PIPELINE_STAGES, PipelineStepStates, PipelineStepStatus } from '../../types/seo';
import type { GrowthRunStage } from '../../types/api';
import {
  Check,
  Search,
  Sparkles,
  FileText,
  Activity,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface PipelineVisualizerProps {
  activePipelineStep: number | null;
  stepStates: PipelineStepStates;
  executionLogs: string[];
  stageDetails?: GrowthRunStage[];
}

export const PipelineVisualizer: React.FC<PipelineVisualizerProps> = ({
  activePipelineStep,
  stepStates,
  executionLogs,
  stageDetails = []
}) => {
  const [showLogs, setShowLogs] = React.useState<boolean>(true);
  const [expandedStage, setExpandedStage] = React.useState<number | null>(null);

  const stageIcons: Record<number, React.ReactNode> = {
    1: <Search className="w-4 h-4" />,
    2: <Sparkles className="w-4 h-4" />,
    3: <Sparkles className="w-4 h-4" />,
    4: <FileText className="w-4 h-4" />,
    5: <Activity className="w-4 h-4" />
  };

  const isRunning = activePipelineStep !== null;

  return (
    <div className="space-y-4 pt-1">

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {AUTOMATION_PIPELINE_STAGES.map((stage) => {
          const detail = stageDetails.find((item) => item.stage === stage.code);
          const status: PipelineStepStatus = stepStates[stage.number]
            || (activePipelineStep === stage.number ? 'RUNNING' : 'PENDING');
          const isActive = status === 'RUNNING';
          const isCompleted = status === 'COMPLETED';
          const isPartial = status === 'PARTIAL';
          const isSkipped = status === 'SKIPPED';
          const isFailed = status === 'FAILED';

          const statusLabel = isCompleted
            ? '已完成'
            : isPartial
              ? '部分完成'
              : isSkipped
                ? '已跳过'
                : isFailed
                  ? '已阻止'
                  : isActive
                    ? '执行中'
                    : `步骤 ${stage.number}`;

          return (
            <button
              type="button"
              key={stage.number}
              onClick={() => detail && setExpandedStage((current) => current === stage.number ? null : stage.number)}
              aria-expanded={detail ? expandedStage === stage.number : undefined}
              className={`p-3 sm:p-3.5 rounded-xl border text-center transition-all duration-200 flex flex-col items-center justify-center gap-1.5 ${
                isActive
                  ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-emerald-500/30'
                  : isCompleted
                  ? 'bg-emerald-50/90 text-emerald-950 border-emerald-200 shadow-sm'
                  : isPartial
                  ? 'bg-amber-50/90 text-amber-950 border-amber-200 shadow-sm'
                  : isSkipped
                  ? 'bg-slate-100/90 text-slate-600 border-slate-200 shadow-sm'
                  : isFailed
                  ? 'bg-rose-50/90 text-rose-950 border-rose-200 shadow-sm'
                  : 'bg-slate-50/80 text-slate-600 border-slate-200/80'
              } ${detail ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                isActive
                  ? 'bg-slate-800 text-emerald-400'
                  : isCompleted
                  ? 'bg-emerald-100 text-emerald-700'
                  : isPartial
                  ? 'bg-amber-100 text-amber-700'
                  : isSkipped
                  ? 'bg-slate-200 text-slate-500'
                  : isFailed
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-white text-slate-400 border border-slate-200/80'
              }`}>
                {isCompleted ? (
                  <Check className="w-4 h-4 stroke-[3]" />
                ) : isActive ? (
                  <div className="relative flex items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-4 w-4 rounded-full bg-emerald-400 opacity-60"></span>
                    <span className="relative">{stageIcons[stage.number]}</span>
                  </div>
                ) : (
                  stageIcons[stage.number]
                )}
              </div>

              <div className="space-y-0.5">
                <div className={`font-semibold text-xs sm:text-sm ${
                  isActive
                    ? 'text-white'
                    : isCompleted
                      ? 'text-emerald-900'
                      : isPartial
                        ? 'text-amber-900'
                        : isFailed
                          ? 'text-rose-900'
                          : 'text-slate-700'
                }`}>
                  {stage.title}
                </div>
                <div className={`text-[11px] font-mono ${
                  isActive
                    ? 'text-emerald-400 font-bold'
                    : isCompleted
                      ? 'text-emerald-600'
                      : isPartial
                        ? 'text-amber-600'
                        : isSkipped
                          ? 'text-slate-500'
                          : isFailed
                            ? 'text-rose-600 font-semibold'
                            : 'text-slate-400'
                }`}>
                  {statusLabel}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {expandedStage !== null && (() => {
        const stage = AUTOMATION_PIPELINE_STAGES.find((item) => item.number === expandedStage);
        const detail = stageDetails.find((item) => item.stage === stage?.code);
        if (!stage || !detail) return null;
        return (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm space-y-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-bold text-slate-900">{stage.title} · 真实执行证据</div>
              <div className="text-xs text-slate-500">
                已处理 {detail.processedCount}{typeof detail.totalCount === 'number' ? ` / ${detail.totalCount}` : ''}
              </div>
            </div>
            {detail.summary && <p className="text-slate-700 leading-relaxed">{detail.summary}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>开始：{detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '尚未开始'}</span>
              <span>完成：{detail.finishedAt ? new Date(detail.finishedAt).toLocaleString() : '尚未完成'}</span>
            </div>
            {detail.errorMessage && <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-rose-800">阻止原因：{detail.errorMessage}</div>}
            {detail.evidence.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.evidence.map((evidence, index) => (
                  <span key={`${String(evidence.type || 'EVIDENCE')}-${index}`} className="rounded-md bg-slate-100 border border-slate-200 px-2 py-1 text-xs font-mono text-slate-600">
                    {String(evidence.type || 'EVIDENCE')}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
