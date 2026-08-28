import { z } from "zod";
import { writeJournal } from "../../store/kv.ts";
import { defineTool, jsonResponse } from "../helpers.ts";

const JournalWriteSchema = z.object({
  role: z.string().min(1).describe("The role name to write the journal entry for."),
  entry: z.string().min(1).describe(
    "The journal entry content (current status, decisions, context, next steps).",
  ),
  writtenBy: z.string().optional().describe(
    "Optional identifier of who wrote this entry (e.g. agent name or ID).",
  ),
});

export const journalWriteTool = defineTool({
  name: "journal_write",
  description:
    "Writes a shutdown / status journal entry for a role. Overwrites any previous journal entry for this role, maintaining a single clean snapshot of the role's latest state.",
  schema: JournalWriteSchema,
  execute: async ({ role, entry, writtenBy }) => {
    const journal = await writeJournal(role, entry, writtenBy);
    return jsonResponse({ journal });
  },
});
