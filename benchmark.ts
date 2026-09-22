import { createTasks, listTasks } from "./store/kv/tasks.ts";
import { getKv, closeKv } from "./store/kv/client.ts";

async function main() {
  const kv = await getKv();

  // Clean up before test
  const entries = kv.list({ prefix: ["users", "test-user"] });
  for await (const entry of entries) {
    await kv.delete(entry.key);
  }

  const numTasks = 20000;
  console.log(`Creating ${numTasks} tasks...`);

  const tasksToCreate = Array.from({ length: numTasks }, (_, i) => ({
    title: `Task ${i}`,
    status: (i % 3 === 0) ? "open" : (i % 3 === 1) ? "in_progress" : "completed",
    userId: "test-user",
  }));

  // Create in chunks of 500
  for (let i = 0; i < numTasks; i += 500) {
    await createTasks(tasksToCreate.slice(i, i + 500));
  }

  console.log("Measuring listTasks without status filter...");
  let start1 = performance.now();
  await listTasks({ limit: 10, userId: "test-user" });
  let end1 = performance.now();
  console.log(`Optimized full scan time: ${end1 - start1}ms`);

  console.log("Measuring listTasks with status filter...");
  let start2 = performance.now();
  await listTasks({ status: "open", limit: 10, userId: "test-user" });
  let end2 = performance.now();
  console.log(`Optimized status filter time: ${end2 - start2}ms`);

  console.log("Measuring listTasks without ANY filter, but with limit (simulating what the user would see when visiting the tasks page)...");
  let start3 = performance.now();
  await listTasks({ limit: 10, userId: "test-user" });
  let end3 = performance.now();
  console.log(`Optimized simple list time: ${end3 - start3}ms`);

  await closeKv();
}

main().catch(console.error);
