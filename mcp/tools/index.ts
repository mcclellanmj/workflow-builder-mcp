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
import { workflowHydrateTool } from "./hydrate_workflow.ts";
import { validateWorkflowTool } from "./validate_workflow.ts";
import { visualizeWorkflowTool } from "./visualize_workflow.ts";
import { extractSubworkflowTool } from "./extract_subworkflow.ts";
import { exportWorkflowTool } from "./export_workflow.ts";
import { importWorkflowTool } from "./import_workflow.ts";
import { searchWorkflowTool } from "./search_workflow.ts";
import { workflowPatchTool } from "./patch_workflow.ts";
import { workflowTreeTool } from "./tree_workflow.ts";

// Task tools
import { createTaskTool } from "./task_create.ts";
import { taskCreateBatchTool } from "./task_create_batch.ts";
import { listTasksTool } from "./task_list.ts";
import { getTaskTool } from "./task_get.ts";
import { updateTaskTool } from "./task_update.ts";
import { closeTaskTool } from "./task_close.ts";
import { readyTasksTool } from "./task_ready.ts";
import { claimTaskTool } from "./task_claim.ts";
import { dependTaskTool } from "./task_depend.ts";
import { commentTaskTool } from "./task_comment.ts";

// Pipeline & FlowTemplate tools
import { pipelineTemplateCreateTool } from "./pipeline_template_create.ts";
import { pipelineTemplateListTool } from "./pipeline_template_list.ts";
import { pipelineTemplateGetTool } from "./pipeline_template_get.ts";
import { taskPipelineAttachTool } from "./task_pipeline_attach.ts";
import { taskPipelineOverrideTool } from "./task_pipeline_override.ts";
import { taskPipelineStatusTool } from "./task_pipeline_status.ts";

// Memory tools
import { memorySaveTool } from "./memory_save.ts";
import { memoryListTool } from "./memory_list.ts";
import { memoryRecallTool } from "./memory_recall.ts";
import { memoryDeleteTool } from "./memory_delete.ts";
import { memorySearchTool } from "./memory_search.ts";

// Role & Journal tools
import { roleCreateTool } from "./role_create.ts";
import { roleListTool } from "./role_list.ts";
import { journalWriteTool } from "./journal_write.ts";
import { journalReadTool } from "./journal_read.ts";

// Handoff & Context Prime tools
import { taskHandoffTool } from "./task_handoff.ts";
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
  journalReadTool,
  journalWriteTool,
  listNodesTool,
  listTasksTool,
  listWorkflowsTool,
  memoryDeleteTool,
  memoryListTool,
  memoryRecallTool,
  memorySaveTool,
  memorySearchTool,
  pipelineTemplateCreateTool,
  pipelineTemplateGetTool,
  pipelineTemplateListTool,
  readyTasksTool,
  roleCreateTool,
  roleListTool,
  searchWorkflowTool,
  searchWorkflowTool as workflowSearchTool,
  taskCreateBatchTool,
  taskHandoffTool,
  taskPipelineAttachTool,
  taskPipelineOverrideTool,
  taskPipelineStatusTool,
  updateTaskTool,
  validateWorkflowTool,
  visualizeWorkflowTool,
  workflowHydrateTool,
  workflowPatchTool,
  workflowTreeTool,
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
  workflowHydrateTool,
  validateWorkflowTool,
  visualizeWorkflowTool,
  extractSubworkflowTool,
  exportWorkflowTool,
  importWorkflowTool,
  searchWorkflowTool,
  workflowPatchTool,
  workflowTreeTool,
  // Tasks
  createTaskTool,
  taskCreateBatchTool,
  listTasksTool,
  getTaskTool,
  updateTaskTool,
  closeTaskTool,
  readyTasksTool,
  claimTaskTool,
  dependTaskTool,
  commentTaskTool,
  // Pipelines & Flow Templates
  pipelineTemplateCreateTool,
  pipelineTemplateListTool,
  pipelineTemplateGetTool,
  taskPipelineAttachTool,
  taskPipelineOverrideTool,
  taskPipelineStatusTool,
  // Memory
  memorySaveTool,
  memoryListTool,
  memoryRecallTool,
  memoryDeleteTool,
  memorySearchTool,
  // Roles & Journal
  roleCreateTool,
  roleListTool,
  journalWriteTool,
  journalReadTool,
  // Handoff & Context Prime
  taskHandoffTool,
  contextPrimeTool,
];
