/**
 * Filesystem read tools (Phase 4, ADR-0009).
 *
 * All tools are rooted at a workspace root and refuse to escape it
 * (path-traversal guard). Only `filesystem_read` capability is required —
 * these tools never write.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AsyncResult,
  PlatformError,
  Tool,
  ToolDescriptor,
  ToolId,
  ToolInvocation,
  ToolResult,
} from "@ai-review/core";

/** Shared failure helper for tools (never throws across the contract). */
export function toolError(
  code: string,
  message: string,
  category: PlatformError["category"] = "validation",
): { ok: false; error: PlatformError } {
  return { ok: false, error: { category, code, message } };
}

/**
 * Resolves `raw` relative to `root` and guarantees the result stays inside the
 * workspace. Returns an error result on traversal instead of throwing.
 */
export function resolveInside(
  root: string,
  raw: string,
): { ok: true; value: string } | { ok: false; error: PlatformError } {
  if (typeof raw !== "string" || raw.length === 0) {
    return toolError(
      "tool.fs.invalid_path",
      "input.path must be a non-empty string",
    );
  }
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, raw);
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(normalizedRoot + path.sep)
  ) {
    return toolError(
      "tool.fs.outside_workspace",
      `path "${raw}" escapes the workspace root`,
      "unauthorized",
    );
  }
  return { ok: true, value: resolved };
}

/** Directories never walked by list/search tools. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "release",
]);

/** Reads a UTF-8 file, optionally bounded to `maxBytes` (default 1 MiB). */
export class ReadFileTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: "tool.fs.read" as ToolId,
    name: "fs.read",
    description:
      "Read a UTF-8 text file inside the workspace (path-traversal guarded, size-bounded).",
    origin: "internal",
    schema: {
      input: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          maxBytes: { type: "number", description: "Optional read cap in bytes" },
        },
        required: ["path"],
      },
      output: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          truncated: { type: "boolean" },
          bytes: { type: "number" },
        },
      },
    },
    capabilities: ["filesystem_read"],
  };

  constructor(
    private readonly root: string,
    private readonly defaultMaxBytes = 1_048_576,
  ) {}

  async invoke(invocation: ToolInvocation): AsyncResult<ToolResult> {
    const requested = invocation.input["path"];
    const resolved = resolveInside(this.root, String(requested));
    if (!resolved.ok) return resolved;

    const maxBytes =
      typeof invocation.input["maxBytes"] === "number"
        ? invocation.input["maxBytes"]
        : this.defaultMaxBytes;

    let stat;
    try {
      stat = await fs.stat(resolved.value);
    } catch (cause) {
      return toolError(
        "tool.fs.stat_failed",
        `cannot stat "${String(requested)}": ${cause instanceof Error ? cause.message : String(cause)}`,
        "not_found",
      );
    }
    if (!stat.isFile()) {
      return toolError(
        "tool.fs.not_a_file",
        `"${String(requested)}" is not a regular file`,
      );
    }

    const handle = await fs.open(resolved.value, "r");
    try {
      const truncated = stat.size > maxBytes;
      const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
      await handle.read(buffer, 0, buffer.length, 0);
      return {
        ok: true,
        value: {
          output: {
            path: String(requested),
            content: buffer.toString("utf8"),
            truncated,
            bytes: Math.min(stat.size, maxBytes),
          },
        },
      };
    } finally {
      await handle.close();
    }
  }
}

/** Lists files under a workspace directory (bounded, sorted, noise skipped). */
export class ListFilesTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: "tool.fs.list" as ToolId,
    name: "fs.list",
    description:
      "List workspace files under a directory, recursively, skipping node_modules/dist/.git.",
    origin: "internal",
    schema: {
      input: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory (default: root)",
          },
          maxEntries: { type: "number", description: "Optional cap (default 500)" },
        },
      },
      output: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" } },
          truncated: { type: "boolean" },
        },
      },
    },
    capabilities: ["filesystem_read"],
  };

  constructor(
    private readonly root: string,
    private readonly defaultMaxEntries = 500,
  ) {}

  async invoke(invocation: ToolInvocation): AsyncResult<ToolResult> {
    const raw = invocation.input["path"];
    const resolved =
      raw === undefined || raw === ""
        ? { ok: true as const, value: path.resolve(this.root) }
        : resolveInside(this.root, String(raw));
    if (!resolved.ok) return resolved;

    const maxEntries =
      typeof invocation.input["maxEntries"] === "number"
        ? invocation.input["maxEntries"]
        : this.defaultMaxEntries;

    const files: string[] = [];
    let truncated = false;

    const walk = async (dir: string): Promise<void> => {
      if (truncated) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable directories are skipped, not fatal
      }
      for (const entry of entries) {
        if (truncated) return;
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          files.push(path.relative(this.root, full).split(path.sep).join("/"));
          if (files.length >= maxEntries) truncated = true;
        }
      }
    };

    await walk(resolved.value);
    files.sort();
    return { ok: true, value: { output: { files, truncated } } };
  }
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx",
  ".css", ".scss", ".html", ".yml", ".yaml", ".toml", ".txt",
  ".py", ".kt", ".java", ".swift", ".go", ".rs", ".rb", ".php", ".cs",
  ".sh", ".sql", ".xml", ".svg",
]);

const MAX_SEARCH_FILE_BYTES = 2 * 1_048_576;

/** Searches file contents under a workspace directory for a regex pattern. */
export class SearchFilesTool implements Tool {
  readonly descriptor: ToolDescriptor = {
    id: "tool.fs.search" as ToolId,
    name: "fs.search",
    description:
      "Search file contents under a workspace directory for a regex pattern; returns path:line:match.",
    origin: "internal",
    schema: {
      input: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex to search for" },
          path: {
            type: "string",
            description: "Workspace-relative directory (default: root)",
          },
          maxResults: { type: "number", description: "Optional cap (default 100)" },
        },
        required: ["pattern"],
      },
      output: {
        type: "object",
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                line: { type: "number" },
                text: { type: "string" },
              },
            },
          },
          truncated: { type: "boolean" },
        },
      },
    },
    capabilities: ["filesystem_read"],
  };

  constructor(
    private readonly root: string,
    private readonly defaultMaxResults = 100,
  ) {}

  async invoke(invocation: ToolInvocation): AsyncResult<ToolResult> {
    const pattern = invocation.input["pattern"];
    if (typeof pattern !== "string" || pattern.length === 0) {
      return toolError(
        "tool.fs.invalid_pattern",
        "input.pattern must be a non-empty string",
      );
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (cause) {
      return toolError(
        "tool.fs.invalid_regex",
        `pattern is not a valid regex: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const rawDir = invocation.input["path"];
    const resolved =
      rawDir === undefined || rawDir === ""
        ? { ok: true as const, value: path.resolve(this.root) }
        : resolveInside(this.root, String(rawDir));
    if (!resolved.ok) return resolved;

    const maxResults =
      typeof invocation.input["maxResults"] === "number"
        ? invocation.input["maxResults"]
        : this.defaultMaxResults;

    const matches: { path: string; line: number; text: string }[] = [];
    let truncated = false;

    const walk = async (dir: string): Promise<void> => {
      if (truncated) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (truncated) return;
        const skip =
          entry.name.startsWith(".") ||
          SKIP_DIRS.has(entry.name) ||
          (entry.isFile() &&
            !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()));
        if (skip) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(full);
            if (stat.size > MAX_SEARCH_FILE_BYTES) continue;
            const content = await fs.readFile(full, "utf8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i]!)) {
                matches.push({
                  path: path.relative(this.root, full).split(path.sep).join("/"),
                  line: i + 1,
                  text: lines[i]!.trim().slice(0, 200),
                });
                if (matches.length >= maxResults) {
                  truncated = true;
                  return;
                }
              }
            }
          } catch {
            // unreadable file: skip
          }
        }
      }
    };

    await walk(resolved.value);
    return { ok: true, value: { output: { matches, truncated } } };
  }
}
