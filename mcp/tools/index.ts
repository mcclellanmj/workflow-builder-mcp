/**
 * Barrel export for all MCP tools.
 */

import { createWorkflowTool } from "./create_workflow.ts";
import { listWorkflowsTool } from "./list_workflows.ts";
import { getWorkflowTool } from "./get_workflow.ts";
import { deleteWorkflowTool } from "./delete_workflow.ts";
import { addNodeTool } from "./add_node.ts";
import { editNodeTool } from "./edit_node.ts";
import { deleteNodeTool } from "./delete_node.ts";
import { getNodeTool } from "./get_node.ts";
import { listNodesTool } from "./list_nodes.ts";
import { connectNodesTool } from "./connect_nodes.ts";
import { disconnectNodesTool } from "./disconnect_nodes.ts";
import { startWorkflowTool } from "./start_workflow.ts";
import { getNextStepTool } from "./get_next_step.ts";
import { resetWorkflowTool } from "./reset_workflow.ts";
import { validateWorkflowTool } from "./validate_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";
import { extractSubworkflowTool } from "./extract_subworkflow.ts";
import { exportWorkflowTool } from "./export_workflow.ts";
import { importWorkflowTool } from "./import_workflow.ts";

import type { McpTool } from "../registry.ts";

export {
  addNodeTool,
  connectNodesTool,
  createWorkflowTool,
  deleteNodeTool,
  deleteWorkflowTool,
  disconnectNodesTool,
  editNodeTool,
  exportWorkflowTool,
  extractSubworkflowTool,
  getNextStepTool,
  getNodeTool,
  getWorkflowTool,
  importWorkflowTool,
  listNodesTool,
  listWorkflowsTool,
  resetWorkflowTool,
  startWorkflowTool,
  validateWorkflowTool,
  visualizeWorkflowTool,
};

export const allTools: McpTool[] = [
  createWorkflowTool,
  listWorkflowsTool,
  getWorkflowTool,
  deleteWorkflowTool,
  addNodeTool,
  editNodeTool,
  deleteNodeTool,
  getNodeTool,
  listNodesTool,
  connectNodesTool,
  disconnectNodesTool,
  startWorkflowTool,
  getNextStepTool,
  resetWorkflowTool,
  validateWorkflowTool,
  visualizeWorkflowTool,
  extractSubworkflowTool,
  exportWorkflowTool,
  importWorkflowTool,
];
