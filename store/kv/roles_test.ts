import { assertEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import {
  clearRoleCache,
  createRole,
  deleteRole,
  ensureRole,
  getRole,
  listRoles,
} from "./roles.ts";

Deno.test("Roles - Workflow-scoped CRUD operations", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_role_test";
    const workflowId = "wf-test-1";

    await withUserContext(userId, async () => {
      clearRoleCache();

      // 1. Initial list should be empty
      const initialRoles = await listRoles({ workflowId });
      assertEquals(initialRoles.length, 0);

      // 2. Create role
      const role1 = await createRole({
        workflowId,
        name: "frontend",
        description: "Frontend UI engineer",
      });
      assertEquals(role1.workflowId, workflowId);
      assertEquals(role1.name, "frontend");
      assertEquals(role1.description, "Frontend UI engineer");
      assertEquals(role1.userId, userId);

      // 3. Get role by ID and by name
      const fetchedById = await getRole(role1.id);
      assertEquals(fetchedById?.id, role1.id);

      const fetchedByName = await getRole("frontend", { workflowId });
      assertEquals(fetchedByName?.id, role1.id);

      // Whitespace and case-insensitivity
      const fetchedTrimmed = await getRole("  frontend  ", { workflowId });
      assertEquals(fetchedTrimmed?.id, role1.id);

      // Non-existent role
      const missing = await getRole("non_existent", { workflowId });
      assertEquals(missing, null);

      // 4. Update role via createRole
      const updated = await createRole({
        id: role1.id,
        workflowId,
        name: "frontend",
        description: "Senior Frontend Engineer",
      });
      assertEquals(updated.id, role1.id);
      assertEquals(updated.description, "Senior Frontend Engineer");

      // 5. ensureRole - existing
      const ensuredExisting = await ensureRole(workflowId, "frontend");
      assertEquals(ensuredExisting.id, role1.id);

      // 6. ensureRole - new
      const ensuredNew = await ensureRole(workflowId, "security-reviewer");
      assertEquals(ensuredNew.name, "security-reviewer");
      assertEquals(ensuredNew.workflowId, workflowId);

      const allRoles = await listRoles({ workflowId });
      assertEquals(allRoles.length, 2);

      // 7. Delete role
      await deleteRole(workflowId, role1.id);
      const afterDelete = await listRoles({ workflowId });
      assertEquals(afterDelete.length, 1);
      assertEquals(afterDelete[0].name, "security-reviewer");
    });
  } finally {
    await kv.close();
  }
});

Deno.test("Roles - Validation errors", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const workflowId = "wf-test-val";

    // Empty workflowId
    await assertRejects(
      () => createRole({ workflowId: "", name: "dev" }),
      Error,
      "Workflow ID is required",
    );

    // Empty role name
    await assertRejects(
      () => createRole({ workflowId, name: "   " }),
      Error,
      "Role name cannot be empty",
    );

    // Description too long (> 500)
    await assertRejects(
      () => createRole({ workflowId, name: "dev", description: "x".repeat(501) }),
      Error,
      "500 characters or less",
    );
  } finally {
    await kv.close();
  }
});
