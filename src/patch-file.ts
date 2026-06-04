import {
  chmod,
  open,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface PatchFileInput {
  file_path: string;
  search_block: string;
  replace_block: string;
}

export interface PatchFileCamelCaseInput {
  filePath: string;
  searchBlock: string;
  replaceBlock: string;
}

export interface PatchFileOptions {
  workspaceRoot?: string;
}

export type PatchFileErrorCode =
  | "INVALID_INPUT"
  | "PATH_OUTSIDE_WORKSPACE"
  | "TARGET_IS_DIRECTORY"
  | "BINARY_FILE_REJECTED"
  | "SEARCH_BLOCK_NOT_FOUND"
  | "SEARCH_BLOCK_AMBIGUOUS"
  | "FILE_READ_ERROR"
  | "FILE_WRITE_ERROR";

export const PATCH_FILE_ERROR_CODES = {
  INVALID_INPUT: "INVALID_INPUT",
  PATH_OUTSIDE_WORKSPACE: "PATH_OUTSIDE_WORKSPACE",
  TARGET_IS_DIRECTORY: "TARGET_IS_DIRECTORY",
  BINARY_FILE_REJECTED: "BINARY_FILE_REJECTED",
  SEARCH_BLOCK_NOT_FOUND: "SEARCH_BLOCK_NOT_FOUND",
  SEARCH_BLOCK_AMBIGUOUS: "SEARCH_BLOCK_AMBIGUOUS",
  FILE_READ_ERROR: "FILE_READ_ERROR",
  FILE_WRITE_ERROR: "FILE_WRITE_ERROR",
} as const satisfies Record<PatchFileErrorCode, PatchFileErrorCode>;

export interface PatchFileSuccess {
  ok: true;
  file_path: string;
  replacements: 1;
  line_number: number;
  before_chars: number;
  after_chars: number;
  before_bytes: number;
  after_bytes: number;
}

export interface PatchFileFailure {
  ok: false;
  code: PatchFileErrorCode;
  message: string;
  file_path?: string;
  match_count?: number;
}

export type PatchFileResult = PatchFileSuccess | PatchFileFailure;

type EncodingKind = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

interface DecodedFile {
  text: string;
  encoding: EncodingKind;
}

export async function patchFile(
  input: PatchFileInput | PatchFileCamelCaseInput,
  options: PatchFileOptions = {},
): Promise<PatchFileResult> {
  const normalizedInput = normalizeInput(input);
  const validation = validateInput(normalizedInput);
  if (validation) {
    return validation;
  }

  const rootPath = path.resolve(options.workspaceRoot ?? process.cwd());
  const targetPath = resolveTargetPath(rootPath, normalizedInput.file_path);
  if (!isInsideOrSame(rootPath, targetPath)) {
    return failure(
      "PATH_OUTSIDE_WORKSPACE",
      "Refusing to edit a path outside the configured workspace/root directory.",
      targetPath,
    );
  }

  let targetStats;
  try {
    const linkStats = await lstat(targetPath);
    if (linkStats.isDirectory()) {
      return failure("TARGET_IS_DIRECTORY", "Refusing to edit a directory.", targetPath);
    }

    const realRoot = await realpath(rootPath);
    const realTarget = await realpath(targetPath);
    if (!isInsideOrSame(realRoot, realTarget)) {
      return failure(
        "PATH_OUTSIDE_WORKSPACE",
        "Refusing to edit a path that resolves outside the configured workspace/root directory.",
        targetPath,
      );
    }

    targetStats = await stat(targetPath);
    if (targetStats.isDirectory()) {
      return failure("TARGET_IS_DIRECTORY", "Refusing to edit a directory.", targetPath);
    }
  } catch (error) {
    return failure("FILE_READ_ERROR", `Unable to inspect target file: ${errorMessage(error)}`, targetPath);
  }

  let originalBytes: Buffer;
  try {
    originalBytes = await readFile(targetPath);
  } catch (error) {
    return failure("FILE_READ_ERROR", `Unable to read target file: ${errorMessage(error)}`, targetPath);
  }

  const decoded = decodeTextFile(originalBytes);
  if (!decoded) {
    return failure("BINARY_FILE_REJECTED", "Refusing to edit a likely binary file.", targetPath);
  }

  const matches = countExactOccurrences(decoded.text, normalizedInput.search_block);
  if (matches.count === 0) {
    return failure(
      "SEARCH_BLOCK_NOT_FOUND",
      "search_block was not found. Reread the file and retry with exact current text plus minimal surrounding context.",
      targetPath,
      0,
    );
  }

  if (matches.count > 1) {
    return failure(
      "SEARCH_BLOCK_AMBIGUOUS",
      "search_block matched multiple locations. Retry with additional surrounding context so the block is unique.",
      targetPath,
      matches.count,
    );
  }

  const updatedText =
    decoded.text.slice(0, matches.firstIndex) +
    normalizedInput.replace_block +
    decoded.text.slice(matches.firstIndex + normalizedInput.search_block.length);
  const updatedBytes = encodeTextFile(updatedText, decoded.encoding);

  try {
    await atomicWriteFile(targetPath, updatedBytes, targetStats.mode & 0o7777);
  } catch (error) {
    return failure("FILE_WRITE_ERROR", `Unable to write patched file: ${errorMessage(error)}`, targetPath);
  }

  return {
    ok: true,
    file_path: targetPath,
    replacements: 1,
    line_number: lineNumberAtIndex(decoded.text, matches.firstIndex),
    before_chars: decoded.text.length,
    after_chars: updatedText.length,
    before_bytes: originalBytes.byteLength,
    after_bytes: updatedBytes.byteLength,
  };
}

function normalizeInput(input: PatchFileInput | PatchFileCamelCaseInput): PatchFileInput {
  const candidate = input as Partial<PatchFileInput & PatchFileCamelCaseInput>;
  return {
    file_path: candidate.file_path ?? (candidate.filePath as string),
    search_block: candidate.search_block ?? (candidate.searchBlock as string),
    replace_block: candidate.replace_block ?? (candidate.replaceBlock as string),
  };
}

function validateInput(input: PatchFileInput): PatchFileFailure | undefined {
  if (!input || typeof input.file_path !== "string" || input.file_path.trim() === "") {
    return failure("INVALID_INPUT", "file_path must be a non-empty string.");
  }

  if (typeof input.search_block !== "string" || input.search_block.length === 0) {
    return failure("INVALID_INPUT", "search_block must be a non-empty string.");
  }

  if (typeof input.replace_block !== "string") {
    return failure("INVALID_INPUT", "replace_block must be a string and may be empty.");
  }

  return undefined;
}

function resolveTargetPath(rootPath: string, filePath: string): string {
  return path.resolve(path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath));
}

function isInsideOrSame(rootPath: string, candidatePath: string): boolean {
  const root = normalizeForComparison(rootPath);
  const candidate = normalizeForComparison(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeForComparison(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function decodeTextFile(bytes: Buffer): DecodedFile | undefined {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf16le", text: bytes.subarray(2).toString("utf16le") };
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf16be", text: swapUtf16Bytes(bytes.subarray(2)).toString("utf16le") };
  }

  if (hasLikelyBinaryContent(bytes)) {
    return undefined;
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf8-bom", text: bytes.subarray(3).toString("utf8") };
  }

  return { encoding: "utf8", text: bytes.toString("utf8") };
}

function encodeTextFile(text: string, encoding: EncodingKind): Buffer {
  if (encoding === "utf16le") {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  }

  if (encoding === "utf16be") {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), swapUtf16Bytes(Buffer.from(text, "utf16le"))]);
  }

  if (encoding === "utf8-bom") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
  }

  return Buffer.from(text, "utf8");
}

function hasLikelyBinaryContent(bytes: Buffer): boolean {
  const sampleLength = Math.min(bytes.length, 8192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

function swapUtf16Bytes(bytes: Buffer): Buffer {
  const swapped = Buffer.from(bytes);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = first;
  }
  return swapped;
}

function countExactOccurrences(text: string, searchBlock: string): { count: number; firstIndex: number } {
  let count = 0;
  let firstIndex = -1;
  let nextIndex = text.indexOf(searchBlock);

  while (nextIndex !== -1) {
    count += 1;
    if (firstIndex === -1) {
      firstIndex = nextIndex;
    }
    nextIndex = text.indexOf(searchBlock, nextIndex + searchBlock.length);
  }

  return { count, firstIndex };
}

function lineNumberAtIndex(text: string, index: number): number {
  let lineNumber = 1;
  for (let position = 0; position < index; position += 1) {
    if (text[position] === "\n") {
      lineNumber += 1;
    }
  }
  return lineNumber;
}

async function atomicWriteFile(filePath: string, bytes: Buffer, mode: number): Promise<void> {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const tempPath = path.join(
    directory,
    `.${baseName}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, bytes, { mode });
    await syncFileBestEffort(tempPath);
    await chmod(tempPath, mode);
    await rename(tempPath, filePath);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncFileBestEffort(filePath: string): Promise<void> {
  try {
    const handle = await open(filePath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // fsync is a durability improvement, but some platforms reject it for
    // regular files. The write and same-directory rename remain mandatory.
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some platforms do not allow fsync on directories. The file write and rename
    // still provide the strongest practical atomic replacement available there.
  }
}

function failure(
  code: PatchFileErrorCode,
  message: string,
  filePath?: string,
  matchCount?: number,
): PatchFileFailure {
  return {
    ok: false,
    code,
    message,
    ...(filePath ? { file_path: filePath } : {}),
    ...(matchCount !== undefined ? { match_count: matchCount } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
