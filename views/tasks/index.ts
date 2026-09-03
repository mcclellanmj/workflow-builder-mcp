/**
 * Task Board Kanban & Modal Components — Preact views and atomic building blocks.
 */

export { TaskCard } from "./TaskCard.tsx";
export type { TaskCardItem, TaskCardProps } from "./TaskCard.tsx";

export { TaskColumn } from "./TaskColumn.tsx";
export type { TaskColumnProps } from "./TaskColumn.tsx";

export { DEFAULT_KANBAN_COLUMNS, KanbanBoard } from "./KanbanBoard.tsx";
export type { KanbanBoardProps, KanbanColumnDef } from "./KanbanBoard.tsx";

export { PipelineProgress } from "./PipelineProgress.tsx";
export type { PipelineProgressProps, PipelineStageItem } from "./PipelineProgress.tsx";

export { TaskModal } from "./TaskModal.tsx";
export type {
  TaskChildItem,
  TaskDependencyLinks,
  TaskModalItem,
  TaskModalMode,
  TaskModalProps,
} from "./TaskModal.tsx";

export { TaskApp } from "./TaskApp.tsx";
export type { TaskAppMetrics, TaskAppProps } from "./TaskApp.tsx";
