import { z } from "zod";
import { readJournal } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const JournalReadSchema = z.object({
  role: z.string().min(1).describe("The role name to read the journal entry for."),
});

export const journalReadTool = defineTool({
  name: "journal_read",
  description:
    "Reads the latest journal entry for a role. Returns the single snapshot entry written when the role was last paused or shut down, or null if none exists.",
  schema: JournalReadSchema,
  execute: async ({ role }) => {
    const journal = await readJournal(role);
    return jsonResponse({ journal });
  },
});
