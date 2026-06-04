# patch_file

`patch_file` is a production-ready TypeScript/Node tool for AI agents that need to edit files safely without rewriting whole files.

Agents call it with three fields:

- `file_path`
- `search_block`
- `replace_block`

The engine reads the target file and applies the edit only when `search_block` appears exactly once. If the block is missing or ambiguous, the file is left unchanged and the tool returns a structured error that tells the agent how to retry.

## Why This Exists

AI agents often waste tokens and introduce corruption by emitting entire replacement files for small edits. Full-file rewrites can accidentally drop imports, comments, generated sections, formatting, or user changes that appeared after the agent last read the file.

`patch_file` makes the safer path the default: send only the smallest exact original block that identifies the edit, plus the replacement block. Exact-once matching prevents fuzzy or partial edits from landing in the wrong place.

## How Exact-Once Matching Works

1. The target file is read from disk.
2. `search_block` is matched with strict string matching.
3. No whitespace normalization, fuzzy matching, or partial patching is performed.
4. If the block appears exactly once, that single occurrence is replaced.
5. If the block appears zero times or more than once, nothing is written.

For normal text block replacement, occurrences are counted as non-overlapping exact matches.

## Installation and Local Usage

```bash
npm install
npm run build
npm test
```

During local development:

```bash
npm run typecheck
npm run clean
```

## TypeScript Usage

```ts
import { patchFile, PATCH_FILE_ERROR_CODES } from "patch-file-tool";

const result = await patchFile(
  {
    file_path: "src/config.ts",
    search_block: "export const retries = 2;\n",
    replace_block: "export const retries = 3;\n",
  },
  { workspaceRoot: process.cwd() },
);

if (!result.ok) {
  if (result.code === PATCH_FILE_ERROR_CODES.SEARCH_BLOCK_NOT_FOUND) {
    // Reread the file and retry with exact current text.
  }

  console.error(result.code, result.message);
}
```

Public exports:

- `patchFile`
- `PATCH_FILE_ERROR_CODES`
- `patchFileSchema`
- `PatchFileInput`
- `PatchFileOptions`
- `PatchFileResult`
- `PatchFileSuccess`
- `PatchFileFailure`
- `PatchFileErrorCode`
- `PatchFileSchema`

## JSON Schema

The schema is exported as `patchFileSchema` and is also available at `schemas/patch_file.schema.json`.

```json
{
  "name": "patch_file",
  "description": "Safely edit one file by replacing one exact block of current text with replacement text. Use this instead of rewriting whole files.",
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "required": ["file_path", "search_block", "replace_block"],
    "properties": {
      "file_path": {
        "type": "string",
        "description": "Path to the file to edit, constrained by the configured workspace/root directory."
      },
      "search_block": {
        "type": "string",
        "minLength": 1,
        "description": "Exact original text currently present in the file. Copy it exactly from the current file, preserving indentation and line endings. Provide only the minimal lines needed to uniquely identify the edit, with enough surrounding context so this block appears exactly once. Avoid full-file rewrites. If the tool reports zero matches or multiple matches, reread the file and retry with a larger or more precise search_block."
      },
      "replace_block": {
        "type": "string",
        "description": "Replacement text to insert in place of search_block. It may be empty. Preserve intended indentation and line endings inside this block. Avoid full-file rewrites; replace only the minimal exact block needed for the edit."
      }
    }
  }
}
```

## Success Result

```json
{
  "ok": true,
  "file_path": "/workspace/src/config.ts",
  "replacements": 1,
  "line_number": 1,
  "before_chars": 26,
  "after_chars": 26,
  "before_bytes": 26,
  "after_bytes": 26
}
```

## Failure Results

`SEARCH_BLOCK_NOT_FOUND` means the file was not modified:

```json
{
  "ok": false,
  "code": "SEARCH_BLOCK_NOT_FOUND",
  "message": "search_block was not found. Reread the file and retry with exact current text plus minimal surrounding context.",
  "file_path": "/workspace/src/config.ts",
  "match_count": 0
}
```

`SEARCH_BLOCK_AMBIGUOUS` means the file was not modified:

```json
{
  "ok": false,
  "code": "SEARCH_BLOCK_AMBIGUOUS",
  "message": "search_block matched multiple locations. Retry with additional surrounding context so the block is unique.",
  "file_path": "/workspace/src/config.ts",
  "match_count": 3
}
```

Other stable error codes include:

- `INVALID_INPUT`
- `PATH_OUTSIDE_WORKSPACE`
- `TARGET_IS_DIRECTORY`
- `BINARY_FILE_REJECTED`
- `FILE_READ_ERROR`
- `FILE_WRITE_ERROR`

## Retry Guidance for Agents

When a patch fails, do not guess and do not switch to a full-file rewrite.

- On `SEARCH_BLOCK_NOT_FOUND`, reread the file, copy the exact current text, and retry with minimal context.
- On `SEARCH_BLOCK_AMBIGUOUS`, include a few more surrounding lines so `search_block` appears exactly once.
- Preserve indentation and line endings inside both blocks.
- Keep `search_block` as small as possible while still unique.
- Use an empty `replace_block` when deleting text.

## Security Notes

`patchFile(input, { workspaceRoot })` constrains edits to the configured workspace root. If no root is provided, the current working directory is used.

The engine:

- rejects path traversal outside the workspace;
- rejects absolute paths outside the workspace;
- rejects symlinks that resolve outside the workspace;
- rejects directories;
- rejects likely binary files;
- preserves existing file permissions where practical;
- writes temporary files in the same directory as the target file;
- cleans temporary files after write failures;
- replaces files with a same-directory rename;
- uses best-effort file and directory sync where supported by the platform.

## Limitations

- The tool edits local filesystem paths only.
- It is intentionally strict: no fuzzy matching, no regex mode, and no whitespace normalization.
- Binary detection is conservative and rejects files containing NUL bytes in the sampled prefix.
- Atomic replacement is as strong as practical in Node.js and the host filesystem, but durability semantics vary by operating system and filesystem.
- Encoding preservation currently covers UTF-8, UTF-8 with BOM, UTF-16LE with BOM, and UTF-16BE with BOM.

## Compared With Unified Diffs

Unified diffs are excellent for human review and version-control workflows, but agents can produce malformed hunks, stale line numbers, or patches that require fuzzy application. `patch_file` uses a smaller contract: replace this exact current text if and only if it is unique.

## Compared With Normal Search/Replace

Normal search/replace tools often replace every match, the first match, or a fuzzy match. `patch_file` refuses to write unless there is exactly one strict match, which makes failures safe and machine-readable.

## License

MIT. See `LICENSE`.
