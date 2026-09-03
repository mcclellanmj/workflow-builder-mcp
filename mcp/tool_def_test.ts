import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  defineTool,
  extractSchemaKeys,
  formatValidationError,
  jsonResponse,
  levenshteinDistance,
  suggestPropertyNames,
} from "./tool_def.ts";

Deno.test("Validation - levenshteinDistance", () => {
  assertEquals(levenshteinDistance("", ""), 0);
  assertEquals(levenshteinDistance("abc", "abc"), 0);
  assertEquals(levenshteinDistance("ABC", "abc"), 0); // case insensitive
  assertEquals(levenshteinDistance("task", "task_id"), 3);
  assertEquals(levenshteinDistance("taskId", "task_id"), 1);
  assertEquals(levenshteinDistance("desciption", "description"), 1);
  assertEquals(levenshteinDistance("rol", "role"), 1);
  assertEquals(levenshteinDistance("summry", "summary"), 1);
  assertEquals(levenshteinDistance("asignee", "assignee"), 1);
});

Deno.test("Validation - extractSchemaKeys across schema wrappers", () => {
  const baseSchema = z.object({
    id: z.string(),
    name: z.string(),
    tags: z.array(z.string()).optional(),
  });

  const refinedSchema = baseSchema.refine((d) => d.name.length > 0, {
    message: "Name cannot be empty",
  });

  const defaultOptionalSchema = z
    .object({
      filter: z.string().optional(),
      limit: z.number().default(10),
    })
    .optional()
    .default({});

  const intersectionSchema = z.intersection(
    z.object({ a: z.string() }),
    z.object({ b: z.number() }),
  );

  const baseKeys = extractSchemaKeys(baseSchema);
  assertEquals(baseKeys.sort(), ["id", "name", "tags"].sort());

  const refinedKeys = extractSchemaKeys(refinedSchema);
  assertEquals(refinedKeys.sort(), ["id", "name", "tags"].sort());

  const defaultKeys = extractSchemaKeys(defaultOptionalSchema);
  assertEquals(defaultKeys.sort(), ["filter", "limit"].sort());

  const intersectionKeys = extractSchemaKeys(intersectionSchema);
  assertEquals(intersectionKeys.sort(), ["a", "b"].sort());
});

Deno.test("Validation - suggestPropertyNames fuzzy and alias matching", () => {
  const validKeys = [
    "taskId",
    "task",
    "title",
    "description",
    "roleId",
    "role",
    "workflowId",
    "nodeId",
    "assignee",
    "priority",
    "tags",
  ];

  // 1. Snake case to camelCase matching
  const taskIdSuggestions = suggestPropertyNames("task_id", validKeys);
  assert(taskIdSuggestions.includes("taskId"));
  assert(taskIdSuggestions.includes("task"));

  const roleIdSuggestions = suggestPropertyNames("role_id", validKeys);
  assert(roleIdSuggestions.includes("roleId"));
  assert(roleIdSuggestions.includes("role"));

  // 2. Typo matching (Levenshtein distance <= 2)
  const descSuggestions = suggestPropertyNames("desciption", validKeys);
  assert(descSuggestions.includes("description"));

  const assigneeSuggestions = suggestPropertyNames("asignee", validKeys);
  assert(assigneeSuggestions.includes("assignee"));

  // 3. Domain aliases
  const idSuggestions = suggestPropertyNames("id", validKeys);
  assert(idSuggestions.includes("taskId"));
  assert(idSuggestions.includes("workflowId"));

  const nameSuggestions = suggestPropertyNames("name", validKeys);
  assert(nameSuggestions.includes("title"));

  // 4. Contextual scope suggestions
  const scopeRoleSuggestions = suggestPropertyNames("scopeId", validKeys, { scope: "role" });
  assert(scopeRoleSuggestions.includes("roleId"));
  assert(scopeRoleSuggestions.includes("role"));

  const scopeWfSuggestions = suggestPropertyNames("scopeId", validKeys, { scope: "workflow" });
  assert(scopeWfSuggestions.includes("workflowId"));

  const scopeNodeSuggestions = suggestPropertyNames("scopeId", validKeys, { scope: "node" });
  assert(scopeNodeSuggestions.includes("nodeId"));
});

Deno.test("Validation - formatValidationError structured and prescriptive error output", () => {
  const TestSchema = z
    .object({
      key: z.string().min(1),
      scope: z.enum(["workflow", "node", "role"]),
      roleId: z.string().optional(),
      workflowId: z.string().optional(),
    })
    .refine(
      (d) => {
        if (d.scope === "role") return Boolean(d.roleId);
        return true;
      },
      {
        message: "roleId is required when scope is role",
        path: ["roleId"],
      },
    );

  const parsed = TestSchema.safeParse({
    key: "test-key",
    scope: "role",
    role_id: "developer",
  });

  assert(!parsed.success);

  const formatted = formatValidationError({
    toolName: "test_tool",
    schema: TestSchema,
    rawArgs: { key: "test-key", scope: "role", role_id: "developer" },
    zodIssues: parsed.error.issues,
  });

  assert(formatted.includes('Invalid arguments for tool "test_tool":'));
  assert(formatted.includes("• Failed fields:"));
  assert(formatted.includes("roleId: roleId is required when scope is role"));
  assert(formatted.includes("• Unknown parameters:"));
  assert(formatted.includes("Passed 'role_id' -> Did you mean 'roleId'"));
  assert(formatted.includes("• Scope hint:"));
  assert(formatted.includes("When scope is 'role', you must provide 'roleId'"));
  assert(formatted.includes('• Accepted parameters for "test_tool":'));
  assert(formatted.includes("key"));
  assert(formatted.includes("scope"));
  assert(formatted.includes("roleId"));
  assert(formatted.includes("workflowId"));
});

Deno.test("Validation - defineTool runtime validation and suggestions", async () => {
  const tool = defineTool({
    name: "task_test_tool",
    description: "A test tool for task management",
    schema: z.object({
      taskId: z.string().min(1),
      title: z.string().min(1),
      priority: z.enum(["low", "medium", "high"]).optional(),
      description: z.string().optional(),
    }),
    execute: async (args) => {
      return jsonResponse({ success: true, args });
    },
  });

  // 1. Happy path: valid arguments execute cleanly
  const validRes = await tool.execute({
    taskId: "tk-100",
    title: "Implement feature",
    priority: "high",
  });
  assertEquals(validRes.isError, undefined);
  const data = JSON.parse(validRes.content[0].text);
  assertEquals(data.success, true);
  assertEquals(data.args.taskId, "tk-100");

  // 2. Unknown property / Typo in arguments
  const typoRes = await tool.execute(
    {
      task_id: "tk-100",
      title: "Implement feature",
      desciption: "Typo in description",
    } as unknown as Parameters<typeof tool.execute>[0],
  );
  assertEquals(typoRes.isError, true);
  const typoErrorText = typoRes.content[0].text;
  assert(typoErrorText.includes("Unknown parameters:"));
  assert(typoErrorText.includes("Passed 'task_id' -> Did you mean 'taskId'?"));
  assert(typoErrorText.includes("Passed 'desciption' -> Did you mean 'description'?"));
  assert(
    typoErrorText.includes(
      'Accepted parameters for "task_test_tool": taskId, title, priority, description',
    ),
  );

  // 3. Missing required field
  const missingFieldRes = await tool.execute(
    {
      taskId: "tk-100",
    } as unknown as Parameters<typeof tool.execute>[0],
  );
  assertEquals(missingFieldRes.isError, true);
  const missingErrorText = missingFieldRes.content[0].text;
  assert(missingErrorText.includes("Failed fields:"));
  assert(missingErrorText.includes("title: Required"));

  // 4. Invalid enum value
  const enumRes = await tool.execute({
    taskId: "tk-100",
    title: "Test",
    priority: "critical" as unknown as "low" | "medium" | "high",
  });
  assertEquals(enumRes.isError, true);
  assert(enumRes.content[0].text.includes("priority: Invalid enum value"));
});

Deno.test("Validation - defineTool scope-dependent validation in memory_save", async () => {
  const tool = defineTool({
    name: "scope_test_tool",
    description: "Test tool with scope dependencies",
    schema: z
      .object({
        key: z.string().min(1),
        content: z.string().min(1),
        scope: z.enum(["workflow", "node", "role"]),
        roleId: z.string().optional(),
        workflowId: z.string().optional(),
        nodeId: z.string().optional(),
      })
      .refine(
        (d) => {
          if (d.scope === "role") return Boolean(d.roleId);
          if (d.scope === "workflow") return Boolean(d.workflowId);
          if (d.scope === "node") return Boolean(d.nodeId && d.workflowId);
          return true;
        },
        {
          message: "Scope target ID missing",
          path: ["scope"],
        },
      ),
    execute: async (args) => {
      return jsonResponse({ saved: true, args });
    },
  });

  // 1. Missing roleId when scope=role
  const roleScopeRes = await tool.execute({
    key: "auth-rule",
    content: "Must use PKCE",
    scope: "role",
  });
  assertEquals(roleScopeRes.isError, true);
  const roleErrorText = roleScopeRes.content[0].text;
  assert(roleErrorText.includes("Scope hint: When scope is 'role', you must provide 'roleId'"));

  // 2. Missing workflowId when scope=workflow
  const wfScopeRes = await tool.execute({
    key: "arch-rule",
    content: "DAG only",
    scope: "workflow",
  });
  assertEquals(wfScopeRes.isError, true);
  const wfErrorText = wfScopeRes.content[0].text;
  assert(
    wfErrorText.includes("Scope hint: When scope is 'workflow', you must provide 'workflowId'"),
  );

  // 3. Passing scopeId when scope=role (and scopeId is unknown to this tool)
  const unknownScopeIdRes = await tool.execute(
    {
      key: "auth-rule",
      content: "Must use PKCE",
      scope: "role",
      scopeId: "developer",
    } as unknown as Parameters<typeof tool.execute>[0],
  );
  assertEquals(unknownScopeIdRes.isError, true);
  const unknownScopeIdError = unknownScopeIdRes.content[0].text;
  assert(unknownScopeIdError.includes("Passed 'scopeId' -> Did you mean 'roleId'"));

  // 4. Valid execution with scope=role and roleId
  const validRoleRes = await tool.execute({
    key: "auth-rule",
    content: "Must use PKCE",
    scope: "role",
    roleId: "developer",
  });
  assertEquals(validRoleRes.isError, undefined);
  const validData = JSON.parse(validRoleRes.content[0].text);
  assertEquals(validData.saved, true);
});
