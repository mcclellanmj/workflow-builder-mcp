import type {
  ViewTicket,
  WorkflowEdge,
  WorkflowExportBundle,
  WorkflowNode,
} from "../../store/types.ts";

export interface SsrVisualizerOptions {
  bundle: WorkflowExportBundle;
  activeExecutionId?: string;
  viewTicket?: ViewTicket | null;
  serverOrigin?: string;
  isStandaloneFile?: boolean;
}

export interface LayoutNode {
  node: WorkflowNode;
  x: number;
  y: number;
  width: number;
  height: number;
  rank: number;
}

export interface LayoutEdge {
  edge: WorkflowEdge;
  sourceNode: LayoutNode;
  targetNode: LayoutNode;
  pathD: string;
  labelX: number;
  labelY: number;
  isLoopback: boolean;
}

export interface SsrGraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  minX: number;
  minY: number;
}
