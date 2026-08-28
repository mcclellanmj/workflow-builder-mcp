/**
 * Data model types for the workflow graph system.
 */

/** Unique identifier for a workflow. */
export type WorkflowId = string;

/** Unique identifier for a node within a workflow. */
export type NodeId = string;

/** Unique identifier for an edge within a workflow. */
export type EdgeId = string;

/** The runtime status of a node during workflow execution. */
export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** The type of a workflow node. */
export type NodeType = "start" | "step" | "decision" | "end" | "subworkflow" | "user_interaction";

/** Configuration for subworkflow nodes. */
export interface SubworkflowConfig {
  /** The ID of the child workflow to execute. */
  childWorkflowId: WorkflowId;
  /** Maximum iterations if the child workflow or node is looped (default: 10). */
  maxIterations?: number;
}

/** Configuration for user interaction nodes. */
export interface UserInteractionConfig {
  /** The question or prompt to present to the user. Required. */
  prompt: string;
  /**
   * Named choices to offer the user.
   * Can be a map of { displayLabel: edgeCondition } or an array of option strings.
   * When present, the LLM should use an interactive prompt tool if available
   * and select the corresponding branch condition.
   */
  options?: Record<string, string> | string[];
  /**
   * If true, the user may provide a free-form text response in addition to or instead of options.
   * The response is handled by the orchestrating agent and decision mapped to edge conditions.
   */
  allowFreeText?: boolean;
  /**
   * Hint about what context/findings to surface to the user before prompting.
   */
  contextHint?: string;
}

/** Configuration for nodes with loop controls. */
export interface LoopConfig {
  /** Maximum iterations before failing a loop to prevent infinite runs (default: 10). */
  maxIterations?: number;
}

/** Record of a single past execution iteration of a node. */
export interface IterationRecord {
  iteration: number;
  error: string | null;
  completedAt: string;
}

/** A workflow graph container. */
export interface Workflow {
  id: WorkflowId;
  /** The owner user ID if running in a multi-tenant / scoped environment. */
  userId?: string;
  name: string;
  description: string;
  /**
   * Whether this workflow is intended for independent / top-level execution.
   * Defaults to true. When false, indicates an internal child sub-workflow.
   */
  intendedForIndependentRun?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A single node within a workflow graph. */
export interface WorkflowNode {
  id: NodeId;
  workflowId: WorkflowId;
  /** The owner user ID if running in a multi-tenant / scoped environment. */
  userId?: string;
  type: NodeType;
  name: string;
  /** The instruction / prompt for the agent. Can contain code snippets for external execution. */
  description: string;
  /** If true, the orchestrator should spawn a sub-agent for this node. */
  runInSubAgent: boolean;
  /** Type-specific configuration (e.g. decision options, childWorkflowId). */
  config: Record<string, unknown>;
  /** Runtime execution status. */
  status: NodeStatus;
  /** Error message if the node failed. */
  error: string | null;
  /** Current iteration count (starts at 1 when first executed, increments on loop re-entry). */
  iteration?: number;
  /** History of errors and execution records from previous iterations when looping. */
  iterationHistory?: IterationRecord[];
  createdAt: string;
  updatedAt: string;
}

/** A directed edge connecting two nodes in a workflow graph. */
export interface WorkflowEdge {
  id: EdgeId;
  workflowId: WorkflowId;
  /** The owner user ID if running in a multi-tenant / scoped environment. */
  userId?: string;
  fromNodeId: NodeId;
  toNodeId: NodeId;
  /** For decision nodes: the condition label (e.g. "yes", "no") that selects this edge. */
  condition?: string;
}

/** Structural suggestion for improving workflow modularity and reducing complexity. */
export interface WorkflowSuggestion {
  type: "loop_encapsulation" | "chain_extraction" | "high_complexity";
  title: string;
  message: string;
  nodeIds: string[];
}

/** Summary returned by validation. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: WorkflowSuggestion[];
}

// ---------------------------------------------------------------------------
// Workflow Execution (Run Instance)
// ---------------------------------------------------------------------------

/** Unique identifier for a workflow execution (run instance). */
export type ExecutionId = string;

/** The overall status of a workflow execution. */
export type ExecutionStatus = "in_progress" | "completed" | "failed";

/** Runtime state of a single node within a specific workflow execution. */
export interface NodeExecutionState {
  /** The node this state belongs to. */
  nodeId: NodeId;
  /** Runtime execution status for this execution. */
  status: NodeStatus;
  /** Error message if the node failed. */
  error: string | null;
  /** Current iteration count (starts at 1 when first executed, increments on loop re-entry). */
  iteration?: number;
  /** History of errors and execution records from previous iterations when looping. */
  iterationHistory?: IterationRecord[];
  /** When this node state was last updated. */
  updatedAt: string;
}

/**
 * A single workflow run instance, scoped to one execution of a workflow.
 * Multiple executions can run concurrently against the same workflow template.
 */
export interface WorkflowExecution {
  /** Unique identifier for this execution run. */
  id: ExecutionId;
  /** The workflow template this execution runs. */
  workflowId: WorkflowId;
  /** The owner user ID if running in a multi-tenant / scoped environment. */
  userId?: string;
  /** Overall status of this execution. */
  status: ExecutionStatus;
  /** Per-node runtime state, keyed by node ID. */
  nodeStates: Record<NodeId, NodeExecutionState>;
  /** When this execution was started. */
  createdAt: string;
  /** When this execution was last updated. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Workflow Export & Import
// ---------------------------------------------------------------------------

/** Container for a single workflow with its graph elements and optional executions. */
export interface WorkflowExportData {
  workflow: Workflow;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  executions?: WorkflowExecution[];
}

/** Complete bundle schema for exporting and importing workflows. */
export interface WorkflowExportBundle {
  /** Schema version for export format compatibility. */
  version: "1.0";
  /** ISO timestamp when the bundle was generated. */
  exportedAt: string;
  /** Primary workflow data. */
  workflow: WorkflowExportData;
  /** Recursively collected child subworkflows referenced by the primary workflow. */
  subworkflows?: WorkflowExportData[];
}

/** Result returned after importing a workflow bundle. */
export interface WorkflowImportResult {
  primaryWorkflowId: WorkflowId;
  importedWorkflowIds: WorkflowId[];
  totalNodes: number;
  totalEdges: number;
  totalExecutions: number;
  remapped: boolean;
  /** Mapping of old IDs to new generated IDs if remapIds was true. */
  idMap?: {
    workflows: Record<WorkflowId, WorkflowId>;
    nodes: Record<NodeId, NodeId>;
    edges: Record<EdgeId, EdgeId>;
    executions?: Record<ExecutionId, ExecutionId>;
  };
  validation?: ValidationResult;
}

// ---------------------------------------------------------------------------
// Visualization Share Tickets (30-minute shareable links)
// ---------------------------------------------------------------------------

/** Secure, time-limited ticket for public/shared workflow visualization. */
export interface ViewTicket {
  ticketId: string;
  userId: string;
  workflowId: WorkflowId;
  executionId?: ExecutionId;
  createdAt: string;
  /** Expiration timestamp in milliseconds (e.g. Date.now() + 30 * 60 * 1000). */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Tasks & Dependencies (Beads)
// ---------------------------------------------------------------------------

/** Unique identifier for a task. Hash-based, e.g. "tk-a1b2c3". */
export type TaskId = string;

/** Status lifecycle of a task. */
export type TaskStatus =
  | "open"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "review"
  | "closed"
  | "wontfix";

/** Typed directional dependency between tasks. */
export type DependencyType =
  | "blocks"
  | "parent-child"
  | "waits-for"
  | "conditional-blocks"
  | "discovered-from"
  | "related";

/** Priority levels for tasks. */
export type TaskPriority = "critical" | "high" | "medium" | "low";

/** Type of task item in the task tracking system. */
export type TaskType = "task" | "epic" | "subtask" | "bug";

/** A single assignable unit of work. */
export interface Task {
  id: TaskId;
  userId?: string;

  title: string;
  description: string;
  status: TaskStatus;
  priority?: TaskPriority;
  /** The item type: "task" (default), "epic", "subtask", or "bug". */
  type?: TaskType;

  // --- Ownership ---
  /** Free-form role label. User-defined, e.g. "frontend", "security", "human". */
  role?: string;
  /** Agent or person who claimed this task. */
  assignee?: string;
  claimedAt?: string;

  // --- Workflow linkage ---
  workflowId?: WorkflowId;
  executionId?: ExecutionId;
  nodeId?: NodeId;

  // --- Hierarchy ---
  parentTaskId?: TaskId;

  // --- Context (for handoffs & continuity) ---
  /** Accumulated notes, progress, and context from the working agent. */
  context?: string;
  /** Approaches that were tried and failed — prevents the next agent from repeating. */
  rejectedApproaches?: string[];

  closedReason?: string;
  /** Chronological log of short comments (max 256 chars each). Guaranteed to be an array. */
  comments: TaskComment[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

/** A short comment logged on a task (maximum 256 characters). */
export interface TaskComment {
  id: string;
  taskId: TaskId;
  userId?: string;
  author: string;
  content: string;
  createdAt: string;
}

/** A directed dependency edge between two tasks. */
export interface TaskDependency {
  id: string;
  fromTaskId: TaskId;
  toTaskId: TaskId;
  type: DependencyType;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Roles & Role Journals
// ---------------------------------------------------------------------------

/** A named role that can be assigned to tasks. */
export interface Role {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/** Single-entry journal for a role. Overwritten on each write. */
export interface RoleJournal {
  roleId: string;
  userId?: string;
  /** The journal content — what the role was doing, where it left off. */
  entry: string;
  /** Who wrote this entry (agent identifier). */
  writtenBy?: string;
  writtenAt: string;
}

// ---------------------------------------------------------------------------
// Memory System
// ---------------------------------------------------------------------------

export type MemoryScope = "workflow" | "node" | "role";

/** A persistent memory entry. */
export interface Memory {
  id: string;
  userId?: string;
  key: string;
  /** Short one-line summary shown in memory_list. */
  summary: string;
  /** Full content, returned only by memory_recall. */
  content: string;
  scope: MemoryScope;

  // Scope references (set based on scope)
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  roleId?: string;

  // Metadata
  source?: string;
  tags?: string[];

  createdAt: string;
  updatedAt: string;
}

/** Log entry tracking when a memory was recalled. */
export interface MemoryAccessRecord {
  id: string;
  memoryId: string;
  memoryKey: string;
  accessedAt: string;
  accessedBy?: string;
  executionId?: ExecutionId;
  taskId?: TaskId;
}

// ---------------------------------------------------------------------------
// Work Handoffs
// ---------------------------------------------------------------------------

/** Record of a task being transferred between agents/roles. */
export interface HandoffRecord {
  id: string;
  userId?: string;
  taskId: TaskId;
  fromAssignee: string;
  toAssignee?: string;
  toRole?: string;
  reason: string;
  contextSummary: string;
  rejectedApproaches: string[];
  timestamp: string;
}
