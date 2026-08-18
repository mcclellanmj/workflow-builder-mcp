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
  /** History of outputs/errors from previous iterations when looping. */
  iterationHistory?: IterationRecord[];
  createdAt: string;
  updatedAt: string;
}

/** A directed edge connecting two nodes in a workflow graph. */
export interface WorkflowEdge {
  id: EdgeId;
  workflowId: WorkflowId;
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
  /** History of outputs/errors from previous iterations when looping. */
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
