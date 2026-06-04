import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function withWorkspace(
  run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "patch-file-mcp-test-"));
  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

test("MCP server exposes and executes patch_file over stdio", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    await writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/mcp-server.js"],
      cwd: process.cwd(),
      stderr: "pipe",
      env: {
        PATCH_FILE_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    const client = new Client({ name: "patch-file-test-client", version: "1.0.0" });

    try {
      await client.connect(transport);

      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === "patch_file");
      assert.ok(tool);
      assert.match(tool.description ?? "", /exact block/i);

      const result = await client.callTool({
        name: "patch_file",
        arguments: {
          file_path: "example.txt",
          search_block: "beta\n",
          replace_block: "delta\n",
        },
      });

      assert.equal(result.isError, false);
      assert.deepEqual(result.structuredContent, {
        ok: true,
        file_path: filePath,
        replacements: 1,
        line_number: 2,
        before_chars: 17,
        after_chars: 18,
        before_bytes: 17,
        after_bytes: 18,
      });
      assert.equal(await readFile(filePath, "utf8"), "alpha\ndelta\ngamma\n");
    } finally {
      await client.close();
    }
  });
});
