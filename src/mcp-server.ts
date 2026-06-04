#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { patchFile } from "./patch-file.js";

const server = new McpServer({
  name: "patch-file-tool",
  version: "1.0.0",
});

server.registerTool(
  "patch_file",
  {
    title: "Patch File",
    description:
      "Safely edit one file by replacing one exact block of current text with replacement text. Provide minimal exact context; the tool fails closed if the block is missing or ambiguous.",
    inputSchema: {
      file_path: z
        .string()
        .min(1)
        .describe("Path to the file to edit, constrained by PATCH_FILE_WORKSPACE_ROOT or the current working directory."),
      search_block: z
        .string()
        .min(1)
        .describe(
          "Exact original text currently present in the file. Copy it exactly, preserve indentation and line endings, and include only enough context so it appears exactly once.",
        ),
      replace_block: z
        .string()
        .describe("Replacement text to insert in place of search_block. May be empty for deletion."),
    },
    outputSchema: z.object({ ok: z.boolean() }).passthrough(),
  },
  async (input) => {
    const result = await patchFile(input, {
      workspaceRoot: process.env.PATCH_FILE_WORKSPACE_ROOT ?? process.cwd(),
    });
    const structuredContent = result as unknown as Record<string, unknown>;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
      structuredContent,
      isError: !result.ok,
    };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
