import { countTokens } from "gpt-tokenizer/model/gpt-4o";

const filePath = "src/generated-config.ts";
const originalLines = Array.from(
  { length: 1000 },
  (_, index) => `export const setting${String(index + 1).padStart(4, "0")} = ${index + 1};`,
);
const originalFile = `${originalLines.join("\n")}\n`;
const updatedLines = [...originalLines];
const targetLineIndex = 499;
const oldLine = originalLines[targetLineIndex];
const newLine = "export const setting0500 = 9001;";
updatedLines[targetLineIndex] = newLine;
const updatedFile = `${updatedLines.join("\n")}\n`;

const fullFileRewrite = updatedFile;
const unifiedDiff = [
  `--- a/${filePath}`,
  `+++ b/${filePath}`,
  "@@ -497,7 +497,7 @@",
  originalLines[496],
  originalLines[497],
  originalLines[498],
  `-${oldLine}`,
  `+${newLine}`,
  originalLines[500],
  originalLines[501],
  originalLines[502],
  "",
].join("\n");
const patchFilePayload = JSON.stringify(
  {
    file_path: filePath,
    search_block: `${oldLine}\n`,
    replace_block: `${newLine}\n`,
  },
  null,
  2,
);

const rows = [
  ["Full-file rewrite", fullFileRewrite],
  ["Unified diff", unifiedDiff],
  ["patch_file payload", patchFilePayload],
];

console.log("Token benchmark fixture");
console.log(`Tokenizer: gpt-tokenizer/model/gpt-4o`);
console.log(`File: ${filePath}`);
console.log(`Original file lines: ${originalLines.length}`);
console.log(`Edit: line ${targetLineIndex + 1}`);
console.log("");
console.log("| Strategy | Exact output tokens | Output characters |");
console.log("| --- | ---: | ---: |");
for (const [label, payload] of rows) {
  console.log(`| ${label} | ${countTokens(payload)} | ${payload.length} |`);
}
