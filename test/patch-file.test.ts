import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { PATCH_FILE_ERROR_CODES, patchFile } from "../src/index.js";

async function withWorkspace(
  run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "patch-file-test-"));
  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

test("replaces a search block that appears exactly once", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    await writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");

    const result = await patchFile(
      {
        file_path: "example.txt",
        search_block: "beta\n",
        replace_block: "delta\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, true);
    assert.equal(result.file_path, filePath);
    assert.equal(result.replacements, 1);
    assert.equal(result.line_number, 2);
    assert.equal(await readText(filePath), "alpha\ndelta\ngamma\n");
  });
});

test("accepts camelCase aliases for programmatic TypeScript callers", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    await writeFile(filePath, "const x = 1;\n", "utf8");

    const result = await patchFile(
      {
        filePath: "example.txt",
        searchBlock: "const x = 1;\n",
        replaceBlock: "const x = 2;\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, true);
    assert.equal(await readText(filePath), "const x = 2;\n");
  });
});

test("returns SEARCH_BLOCK_NOT_FOUND and leaves file unchanged when the block is missing", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    const original = "alpha\nbeta\ngamma\n";
    await writeFile(filePath, original, "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "missing\n",
        replace_block: "delta\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "SEARCH_BLOCK_NOT_FOUND");
    assert.match(result.message, /reread the file/i);
    assert.equal(await readText(filePath), original);
  });
});

test("returns SEARCH_BLOCK_AMBIGUOUS and leaves file unchanged when the block is repeated", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    const original = "alpha\nsame\nbeta\nsame\n";
    await writeFile(filePath, original, "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "same\n",
        replace_block: "once\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "SEARCH_BLOCK_AMBIGUOUS");
    assert.equal(result.match_count, 2);
    assert.match(result.message, /additional surrounding context/i);
    assert.equal(await readText(filePath), original);
  });
});

test("allows an empty replacement block", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    await writeFile(filePath, "alpha\nremove me\ngamma\n", "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "remove me\n",
        replace_block: "",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, true);
    assert.equal(await readText(filePath), "alpha\ngamma\n");
  });
});

test("rejects an empty search block without modifying the file", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    const original = "alpha\n";
    await writeFile(filePath, original, "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "",
        replace_block: "beta\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_INPUT");
    assert.equal(await readText(filePath), original);
  });
});

test("rejects a non-string replacement block without modifying the file", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "example.txt");
    const original = "alpha\n";
    await writeFile(filePath, original, "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "alpha\n",
        replace_block: undefined,
      } as unknown as Parameters<typeof patchFile>[0],
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_INPUT");
    assert.equal(await readText(filePath), original);
  });
});

test("rejects path traversal outside the workspace root", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const outsidePath = path.join(path.dirname(workspaceRoot), "outside.txt");
    const original = "alpha\n";
    await writeFile(outsidePath, original, "utf8");

    try {
      const result = await patchFile(
        {
          file_path: path.join(workspaceRoot, "..", "outside.txt"),
          search_block: "alpha\n",
          replace_block: "beta\n",
        },
        { workspaceRoot },
      );

      assert.equal(result.ok, false);
      assert.equal(result.code, "PATH_OUTSIDE_WORKSPACE");
      assert.equal(await readText(outsidePath), original);
    } finally {
      await rm(outsidePath, { force: true });
    }
  });
});

test("rejects an absolute path outside the workspace root", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const outsidePath = path.join(path.dirname(workspaceRoot), "absolute-outside.txt");
    const original = "alpha\n";
    await writeFile(outsidePath, original, "utf8");

    try {
      const result = await patchFile(
        {
          file_path: outsidePath,
          search_block: "alpha\n",
          replace_block: "beta\n",
        },
        { workspaceRoot },
      );

      assert.equal(result.ok, false);
      assert.equal(result.code, "PATH_OUTSIDE_WORKSPACE");
      assert.equal(await readText(outsidePath), original);
    } finally {
      await rm(outsidePath, { force: true });
    }
  });
});

test("rejects directories", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await patchFile(
      {
        file_path: workspaceRoot,
        search_block: "alpha\n",
        replace_block: "beta\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "TARGET_IS_DIRECTORY");
  });
});

test("rejects likely binary files without modifying them", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "binary.bin");
    const original = Buffer.from([0x61, 0x00, 0x62, 0x63]);
    await writeFile(filePath, original);

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "a",
        replace_block: "z",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "BINARY_FILE_REJECTED");
    assert.deepEqual(await readFile(filePath), original);
  });
});

test("writes successful replacements atomically enough to preserve mode and remove temp files", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "script.sh");
    await writeFile(filePath, "#!/bin/sh\necho old\n", { encoding: "utf8", mode: 0o755 });
    const beforeMode = (await stat(filePath)).mode & 0o777;

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "echo old\n",
        replace_block: "echo new\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, true);
    assert.equal((await stat(filePath)).mode & 0o777, beforeMode);
    assert.equal(await readText(filePath), "#!/bin/sh\necho new\n");
  });
});

test("preserves existing CRLF line endings in untouched text", async () => {
  await withWorkspace(async (workspaceRoot) => {
    const filePath = path.join(workspaceRoot, "windows.txt");
    await writeFile(filePath, "alpha\r\nbeta\r\ngamma\r\n", "utf8");

    const result = await patchFile(
      {
        file_path: filePath,
        search_block: "beta\r\n",
        replace_block: "delta\r\n",
      },
      { workspaceRoot },
    );

    assert.equal(result.ok, true);
    assert.equal(await readText(filePath), "alpha\r\ndelta\r\ngamma\r\n");
  });
});

test("exports stable error code constants", () => {
  assert.deepEqual(PATCH_FILE_ERROR_CODES, {
    INVALID_INPUT: "INVALID_INPUT",
    PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
    TARGET_IS_DIRECTORY: "TARGET_IS_DIRECTORY",
    BINARY_FILE_REJECTED: "BINARY_FILE_REJECTED",
    SEARCH_BLOCK_NOT_FOUND: "SEARCH_BLOCK_NOT_FOUND",
    SEARCH_BLOCK_AMBIGUOUS: "SEARCH_BLOCK_AMBIGUOUS",
    FILE_READ_ERROR: "FILE_READ_ERROR",
    FILE_WRITE_ERROR: "FILE_WRITE_ERROR",
  });
});
