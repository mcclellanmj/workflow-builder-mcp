/**
 * Barrel export for all streamlined MCP tools.
 */

// Workflow lifecycle & authoring tools
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
import { validateWorkflowTool } from "./validate_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";
import { extractSubworkflowTool } from "./extract_subworkflow.ts";
import { exportWorkflowTool } from "./export_workflow.ts";
import { importWorkflowTool } from "./import_workflow.ts";
import { workflowPatchTool } from "./patch_workflow.ts";
import { workflowTreeTool } from "./tree_workflow.ts";

// Workflow Execution & Message Board tools
import { workflowRunStartTool } from "./workflow_run_start.ts";
import { workflowRunStatusTool } from "./workflow_run_status.ts";
import { workflowStepAdvanceTool } from "./workflow_step_advance.ts";
import { workflowRunCompleteTool } from "./workflow_run_complete.ts";
import { workflowMessagePostTool } from "./workflow_message_post.ts";
import { workflowMessageReadTool } from "./workflow_message_read.ts";

// Task tools
import { createTaskTool } from "./task_create.ts";
import { taskCreateBatchTool } from "./task_create_batch.ts";
import { listTasksTool } from "./task_list.ts";
import { getTaskTool } from "./task_get.ts";
import { updateTaskTool } from "./task_update.ts";
import { closeTaskTool } from "./task_close.ts";
import { claimTaskTool } from "./task_claim.ts";
import { dependTaskTool } from "./task_depend.ts";
import { commentTaskTool } from "./task_comment.ts";
import { taskHandoffTool } from "./task_handoff.ts";

// Memory tools
import { memorySaveTool } from "./memory_save.ts";
import { memorySearchTool } from "./memory_search.ts";
import { memoryRecallTool } from "./memory_recall.ts";
import { memoryDeleteTool } from "./memory_delete.ts";

// Role & Context Prime tools
import { roleCreateTool } from "./role_create.ts";
import { roleListTool } from "./role_list.ts";
import { contextPrimeTool } from "./context_prime.ts";

import type { McpTool } from "../registry.ts";

export {
  addNodeTool,
  claimTaskTool,
  closeTaskTool,
  commentTaskTool,
  connectNodesTool,
  contextPrimeTool,
  createTaskTool,
  createWorkflowTool,
  deleteNodeTool,
  deleteWorkflowTool,
  dependTaskTool,
  disconnectNodesTool,
  editNodeTool,
  exportWorkflowTool,
  extractSubworkflowTool,
  getNodeTool,
  getTaskTool,
  getWorkflowTool,
  importWorkflowTool,
  listNodesTool,
  listTasksTool,
  listWorkflowsTool,
  listWorkflowsTool as workflowListTool,
  memoryDeleteTool,
  memoryRecallTool,
  memorySaveTool,
  memorySearchTool,
  roleCreateTool,
  roleListTool,
  taskCreateBatchTool,
  taskHandoffTool,
  updateTaskTool,
  validateWorkflowTool,
  visualizeWorkflowTool,
  workflowMessagePostTool,
  workflowMessageReadTool,
  workflowPatchTool,
  workflowRunCompleteTool,
  workflowRunStartTool,
  workflowRunStatusTool,
  workflowStepAdvanceTool,
  workflowTreeTool,
};

export const allTools: McpTool[] = [
  // Workflow Authoring & Analysis
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
  validateWorkflowTool,
  visualizeWorkflowTool,
  extractSubworkflowTool,
  exportWorkflowTool,
  importWorkflowTool,
  workflowPatchTool,
  workflowTreeTool,

  // Execution & Message Board
  workflowRunStartTool,
  workflowRunStatusTool,
  workflowStepAdvanceTool,
  workflowRunCompleteTool,
  workflowMessagePostTool,
  workflowMessageReadTool,

  // Tasks & Handoff
  createTaskTool,
  taskCreateBatchTool,
  listTasksTool,
  getTaskTool,
  updateTaskTool,
  closeTaskTool,
  claimTaskTool,
  dependTaskTool,
  commentTaskTool,
  taskHandoffTool,

  // Memory
  memorySaveTool,
  memorySearchTool,
  memoryRecallTool,
  memoryDeleteTool,

  // Roles & Context Prime
  roleCreateTool,
  roleListTool,
  contextPrimeTool,
];
