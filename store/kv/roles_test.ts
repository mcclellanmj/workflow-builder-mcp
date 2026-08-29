import { assertEquals, assertRejects } from "@std/assert";
import { withUserContext } from "../../auth/context.ts";
import { setKv } from "./client.ts";
import {
  clearRoleCache,
  createRole,
  ensureRole,
  getRole,
  listRoles,
  readJournal,
  writeJournal,
} from "./roles.ts";

Deno.test("Roles - CRUD and Journal operations", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userId = "user_role_test";

    await withUserContext(userId, async () => {
      // 1. Initial list should be empty
      const initialRoles = await listRoles();
      assertEquals(initialRoles.length, 0);

      // 2. Create role
      const role1 = await createRole({
        name: "frontend",
        description: "Frontend UI engineer",
      });
      assertEquals(role1.name, "frontend");
      assertEquals(role1.description, "Frontend UI engineer");
      assertEquals(role1.userId, userId);

      // 3. Get role
      const fetched = await getRole("frontend");
      assertEquals(fetched?.id, role1.id);
      assertEquals(fetched?.name, "frontend");

      // Whitespace trimming
      const fetchedTrimmed = await getRole("  frontend  ");
      assertEquals(fetchedTrimmed?.id, role1.id);

      // Non-existent role
      const missing = await getRole("non_existent");
      assertEquals(missing, null);

      // 4. Update role via createRole
      const updated = await createRole({
        name: "frontend",
        description: "Senior Frontend Engineer",
      });
      assertEquals(updated.id, role1.id);
      assertEquals(updated.description, "Senior Frontend Engineer");
      assertEquals(updated.createdAt, role1.createdAt);

      // 5. ensureRole - existing
      const ensuredExisting = await ensureRole("frontend");
      assertEquals(ensuredExisting.id, role1.id);

      // 6. ensureRole - new
      const ensuredNew = await ensureRole("security-reviewer");
      assertEquals(ensuredNew.name, "security-reviewer");

      const allRoles = await listRoles();
      assertEquals(allRoles.length, 2);

      // 7. Role journals - initially null
      const initialJournal = await readJournal("frontend");
      assertEquals(initialJournal, null);

      // Write journal
      const j1 = await writeJournal("frontend", "Working on login form", "agent-alpha");
      assertEquals(j1.roleId, "frontend");
      assertEquals(j1.entry, "Working on login form");
      assertEquals(j1.writtenBy, "agent-alpha");
      assertEquals(j1.userId, userId);

      const read1 = await readJournal("frontend");
      assertEquals(read1?.entry, "Working on login form");
      assertEquals(read1?.writtenBy, "agent-alpha");

      // Overwrite journal (single-entry snapshot)
      const j2 = await writeJournal(
        "frontend",
        "Finished login form, starting dashboard",
        "agent-beta",
      );
      assertEquals(j2.entry, "Finished login form, starting dashboard");
      assertEquals(j2.writtenBy, "agent-beta");

      const read2 = await readJournal("frontend");
      assertEquals(read2?.entry, "Finished login form, starting dashboard");
      assertEquals(read2?.writtenBy, "agent-beta");

      // Journal auto-creates role if role didn't exist
      const jDevOps = await writeJournal("devops", "Setting up CI", "agent-gamma");
      assertEquals(jDevOps.roleId, "devops");
      const devopsRole = await getRole("devops");
      assertEquals(devopsRole?.name, "devops");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Roles - User Tenant Isolation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    const userAlice = "user_alice_roles";
    const userBob = "user_bob_roles";

    // Alice creates role and journal
    await withUserContext(userAlice, async () => {
      await createRole({ name: "qa-tester", description: "Alice QA" });
      await writeJournal("qa-tester", "Alice testing v1.0", "alice-agent");
    });

    // Bob cannot see Alice's role or journal
    await withUserContext(userBob, async () => {
      const bobRoles = await listRoles();
      assertEquals(bobRoles.length, 0);

      const bobGet = await getRole("qa-tester");
      assertEquals(bobGet, null);

      const bobJournal = await readJournal("qa-tester");
      assertEquals(bobJournal, null);

      // Bob creates his own role with same name
      await createRole({ name: "qa-tester", description: "Bob QA" });
      await writeJournal("qa-tester", "Bob testing v2.0", "bob-agent");
    });

    // Alice's data remains unmodified
    await withUserContext(userAlice, async () => {
      const aliceRole = await getRole("qa-tester");
      assertEquals(aliceRole?.description, "Alice QA");

      const aliceJournal = await readJournal("qa-tester");
      assertEquals(aliceJournal?.entry, "Alice testing v1.0");
    });
  } finally {
    kv.close();
  }
});

Deno.test("Roles - Validation errors on invalid inputs", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);

  try {
    await withUserContext("user_test", async () => {
      await assertRejects(
        () => createRole({ name: "   " }),
        Error,
        "Role name cannot be empty",
      );

      await assertRejects(
        () => ensureRole(""),
        Error,
        "Role name cannot be empty",
      );

      await assertRejects(
        () => writeJournal("", "something"),
        Error,
        "Role name cannot be empty",
      );
    });
  } finally {
    kv.close();
  }
});

Deno.test("Roles - In-memory caching and cache invalidation", async () => {
  const kv = await Deno.openKv(":memory:");
  setKv(kv);
  clearRoleCache();

  try {
    const userId = "user_cache_test";

    await withUserContext(userId, async () => {
      // 1. Create role populates cache
      const created = await createRole({ name: "backend-dev", description: "Backend Engineer" });
      assertEquals(created.name, "backend-dev");

      // 2. getRole returns cached object directly
      const fetched1 = await getRole("backend-dev");
      assertEquals(fetched1?.id, created.id);

      // 3. ensureRole returns cached object without KV lookup
      const ensured = await ensureRole("backend-dev");
      assertEquals(ensured.id, created.id);

      // 4. Update via createRole updates cache
      const updated = await createRole({
        name: "backend-dev",
        description: "Lead Backend Engineer",
      });
      assertEquals(updated.description, "Lead Backend Engineer");

      const fetched2 = await getRole("backend-dev");
      assertEquals(fetched2?.description, "Lead Backend Engineer");

      // 5. Clearing cache causes fresh KV lookup
      clearRoleCache();
      const fetched3 = await getRole("backend-dev");
      assertEquals(fetched3?.id, created.id);
      assertEquals(fetched3?.description, "Lead Backend Engineer");
    });
  } finally {
    clearRoleCache();
    kv.close();
  }
});
