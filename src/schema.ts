export const patchFileSchema = {
  name: "patch_file",
  description:
    "Safely edit one file by replacing one exact block of current text with replacement text. Use this instead of rewriting whole files.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["file_path", "search_block", "replace_block"],
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file to edit, constrained by the configured workspace/root directory.",
      },
      search_block: {
        type: "string",
        minLength: 1,
        description:
          "Exact original text currently present in the file. Copy it exactly from the current file, preserving indentation and line endings. Provide only the minimal lines needed to uniquely identify the edit, with enough surrounding context so this block appears exactly once. Avoid full-file rewrites. If the tool reports zero matches or multiple matches, reread the file and retry with a larger or more precise search_block.",
      },
      replace_block: {
        type: "string",
        description:
          "Replacement text to insert in place of search_block. It may be empty. Preserve intended indentation and line endings inside this block. Avoid full-file rewrites; replace only the minimal exact block needed for the edit.",
      },
    },
  },
} as const;

export type PatchFileSchema = typeof patchFileSchema;
