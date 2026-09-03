import type { VNode } from "preact";
import type { StageStatus, TaskPipeline, TaskPipelineStage } from "../../store/types.ts";

export interface PipelineStageItem {
  id: string;
  name: string;
  role?: string;
  description?: string;
  status?: StageStatus | string;
  assignee?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineProgressProps {
  pipeline?: TaskPipeline | null;
  stages?: Array<TaskPipelineStage | PipelineStageItem>;
  currentStageId?: string;
  currentStageIndex?: number;
  rejectionCount?: number;
  onStageClick?: (stage: TaskPipelineStage | PipelineStageItem) => void;
  compact?: boolean;
  class?: string;
  className?: string;
}

const STAGE_STATUS_STYLES: Record<string, { badge: string; step: string; icon: string }> = {
  completed: {
    badge: "bg-emerald-950/70 text-emerald-400 border-emerald-800/60",
    step: "bg-emerald-600 text-white border-emerald-500",
    icon: "✓",
  },
  active: {
    badge: "bg-sky-950/80 text-sky-400 border-sky-700/80 ring-2 ring-sky-500/30",
    step: "bg-sky-600 text-white border-sky-400 ring-2 ring-sky-400/40",
    icon: "▶",
  },
  rejected: {
    badge: "bg-rose-950/80 text-rose-300 border-rose-700/80 font-bold",
    step: "bg-rose-600 text-white border-rose-500",
    icon: "✕",
  },
  skipped: {
    badge: "bg-gray-800/70 text-gray-400 border-gray-700/60",
    step: "bg-gray-700 text-gray-300 border-gray-600",
    icon: "↷",
  },
  pending: {
    badge: "bg-gray-900/60 text-gray-400 border-gray-800",
    step: "bg-gray-800 text-gray-400 border-gray-700",
    icon: "○",
  },
};

/**
 * PipelineProgress renders a visual multi-stage step indicator for task flow pipelines
 * (e.g., dev -> review -> audit), depicting completed steps, active stage, and rejection badges.
 */
export function PipelineProgress({
  pipeline,
  stages: customStages,
  currentStageId,
  currentStageIndex,
  rejectionCount,
  onStageClick,
  compact = false,
  class: classProp,
  className,
}: PipelineProgressProps): VNode | null {
  const customClass = classProp || className || "";

  // Resolve stages list
  const stages: Array<TaskPipelineStage | PipelineStageItem> = customStages ||
    (pipeline && pipeline.stages ? pipeline.stages : []);

  if (stages.length === 0) {
    return null;
  }

  // Resolve current stage
  const activeStageId = currentStageId || (pipeline ? pipeline.currentStageId : undefined);
  const activeStageIdx = currentStageIndex !== undefined
    ? currentStageIndex
    : pipeline?.currentStageIndex !== undefined
    ? pipeline.currentStageIndex
    : activeStageId
    ? stages.findIndex((s) => s.id === activeStageId)
    : -1;

  const totalRejections = rejectionCount !== undefined
    ? rejectionCount
    : (pipeline?.rejectionCount ?? 0);

  return (
    <div
      class={`pipeline-progress flex flex-col gap-3 p-3.5 rounded-xl bg-gray-950/90 border border-gray-800 ${customClass}`
        .trim()}
      data-current-stage={activeStageId || ""}
    >
      {/* Header Info */}
      <div class="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div class="flex items-center gap-2">
          <span class="font-bold text-gray-200 flex items-center gap-1.5">
            <span>⚡</span>
            <span>Pipeline Flow</span>
          </span>
          {pipeline?.templateId && (
            <span class="font-mono text-[11px] text-gray-400 bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/60">
              {pipeline.templateId}
            </span>
          )}
        </div>

        {/* Rejection Loop Badge */}
        {totalRejections > 0 && (
          <span
            class="badge inline-flex items-center gap-1 font-mono text-[11px] font-bold text-rose-300 bg-rose-950/80 border border-rose-700/80 px-2 py-0.5 rounded-full"
            title={`${totalRejections} rejection cycles occurred in this pipeline`}
          >
            <span>⚠️</span>
            <span>{totalRejections} {totalRejections === 1 ? "Rejection" : "Rejections"}</span>
          </span>
        )}
      </div>

      {/* Stepper Progress Bar */}
      <div class="flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin scrollbar-thumb-gray-800">
        {stages.map((stage, idx) => {
          const isCurrent = (activeStageId && stage.id === activeStageId) ||
            (activeStageIdx !== -1 && idx === activeStageIdx);

          let stageStatus: string = (stage.status || "").toLowerCase();
          if (!stageStatus) {
            if (activeStageIdx !== -1) {
              if (idx < activeStageIdx) stageStatus = "completed";
              else if (idx === activeStageIdx) stageStatus = "active";
              else stageStatus = "pending";
            } else {
              stageStatus = "pending";
            }
          }

          const styleConfig = STAGE_STATUS_STYLES[stageStatus] || STAGE_STATUS_STYLES.pending;
          const isLast = idx === stages.length - 1;

          return (
            <div key={stage.id} class="flex items-center gap-2 shrink-0">
              {/* Stage Step Item */}
              <div
                class={`flex items-center gap-2.5 p-2 rounded-lg border transition-all select-none ${
                  onStageClick ? "cursor-pointer hover:border-gray-600" : ""
                } ${
                  isCurrent
                    ? "bg-gray-900 border-sky-600/80 shadow-md"
                    : "bg-gray-900/50 border-gray-800"
                }`}
                onClick={() => onStageClick?.(stage)}
                title={stage.description || `${stage.name} (${stageStatus})`}
              >
                {/* Step Circle */}
                <span
                  class={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 ${styleConfig.step}`}
                >
                  {styleConfig.icon}
                </span>

                {/* Stage Meta */}
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span
                      class={`text-xs font-semibold truncate ${
                        isCurrent ? "text-sky-300" : "text-gray-200"
                      }`}
                    >
                      {stage.name}
                    </span>
                    {stage.role && (
                      <span class="font-mono text-[10px] text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-1.5 py-0.2 rounded">
                        @{stage.role}
                      </span>
                    )}
                  </div>

                  {!compact && (
                    <div class="flex items-center gap-1.5 mt-0.5">
                      <span
                        class={`badge inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1 py-0.2 rounded border ${styleConfig.badge}`}
                      >
                        {stageStatus}
                      </span>
                      {stage.assignee && (
                        <span class="text-[10px] text-gray-400 truncate">
                          👤 {stage.assignee}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Arrow Connector to Next Step */}
              {!isLast && (
                <span
                  class="text-gray-600 text-sm font-bold select-none shrink-0"
                  aria-hidden="true"
                >
                  ➔
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
