/**
 * Repository path filtering, binary detection, size limits, and language classification.
 */

import type { IndexFilterOptions, SupportedLanguage } from "./types.js";

export const DEFAULT_MAX_FILE_SIZE_BYTES = 262_144; // 256 KB
export const DEFAULT_MAX_FILES = 5_000;

/**
 * Default excluded directories, lockfiles, vendored/generated assets, and binaries.
 */
export const DEFAULT_INDEX_IGNORE_PATTERNS: readonly string[] = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/.nyc_output/**",
  "**/vendor/**",
  "**/third_party/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/target/**",
  "**/bin/**",
  "**/obj/**",
  "**/.data/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/*.map",
  "**/*.d.ts",
  "**/*.tsbuildinfo",
  "**/*.pb.go",
  "**/*.pb.ts",
  "**/*.generated.*",
  "**/*_generated.*",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/Gemfile.lock",
  "**/poetry.lock",
  "**/composer.lock",
  "**/go.sum",
  "**/*.lock",
];

const BINARY_EXTENSIONS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".avif",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".mov",
  ".avi",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".war",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".DS_Store",
]);

const EXTENSION_TO_LANG: Readonly<Record<string, SupportedLanguage>> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java",
  ".kt": "kt",
  ".kts": "kt",
  ".rb": "rb",
  ".php": "php",
  ".cs": "cs",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".c": "c",
  ".h": "c",
  ".sql": "sql",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".md": "md",
  ".mdx": "md",
};

/**
 * Normalizes a repository-relative path to forward slashes without leading `./` or `/`.
 */
export function normalizeRepoPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/+|\/+)/, "")
    .replace(/\/+/g, "/")
    .trim();
}

/**
 * Detects language from a repository file path extension.
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const normalized = normalizeRepoPath(filePath).toLowerCase();
  const lastSlash = normalized.lastIndexOf("/");
  const baseName = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const dotIdx = baseName.lastIndexOf(".");
  if (dotIdx === -1) return "other";
  const ext = baseName.slice(dotIdx);
  return EXTENSION_TO_LANG[ext] ?? "other";
}

/**
 * Returns true if the language supports TypeScript/JavaScript AST extraction via `extractFile()`.
 */
export function isAstExtractableLanguage(lang: SupportedLanguage): boolean {
  return lang === "ts" || lang === "tsx" || lang === "js" || lang === "jsx";
}

/**
 * Returns true if the file extension is a known binary format.
 */
export function hasBinaryExtension(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  const lastSlash = normalized.lastIndexOf("/");
  const baseName = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  if (baseName === ".DS_Store") return true;
  const dotIdx = baseName.lastIndexOf(".");
  if (dotIdx === -1) return false;
  const ext = baseName.slice(dotIdx).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Checks whether content appears to be binary (contains a NUL byte in the first 8 KB).
 */
export function isBinaryContent(content: string | Uint8Array): boolean {
  if (typeof content === "string") {
    const sampleLength = Math.min(content.length, 8192);
    for (let i = 0; i < sampleLength; i++) {
      if (content.charCodeAt(i) === 0) return true;
    }
    return false;
  }
  const sampleLength = Math.min(content.byteLength, 8192);
  for (let i = 0; i < sampleLength; i++) {
    if (content[i] === 0) return true;
  }
  return false;
}

/**
 * Converts a .gitignore-style glob pattern into a RegExp matching normalized repo paths.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob.trim().replace(/\\/g, "/");
  if (pattern.startsWith("/")) {
    pattern = pattern.slice(1);
  }
  if (pattern.endsWith("/")) {
    pattern = `**/${pattern}**`;
  } else if (!pattern.includes("/")) {
    pattern = `**/${pattern}`;
  }

  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if ("+^$().|[]{}".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

/**
 * Parses raw `.gitignore` file text into glob patterns (ignoring comments and negations).
 */
export function parseGitignorePatterns(gitignoreContent: string): string[] {
  const patterns: string[] = [];
  for (const rawLine of gitignoreContent.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    patterns.push(trimmed);
  }
  return patterns;
}

export class PathFilter {
  private readonly ignoreRegexps: readonly RegExp[];
  readonly maxFileSizeBytes: number;
  readonly maxFiles: number;

  constructor(options?: IndexFilterOptions) {
    this.maxFileSizeBytes =
      options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    const allPatterns = [
      ...DEFAULT_INDEX_IGNORE_PATTERNS,
      ...(options?.extraIgnorePatterns ?? []),
    ];
    this.ignoreRegexps = allPatterns.map(globToRegExp);
  }

  /**
   * Returns true if the given relative path should be excluded from indexing.
   */
  shouldExcludePath(rawPath: string): boolean {
    const normalized = normalizeRepoPath(rawPath);
    if (!normalized) return true;
    if (hasBinaryExtension(normalized)) return true;
    for (const rx of this.ignoreRegexps) {
      if (rx.test(normalized)) return true;
    }
    return false;
  }

  /**
   * Returns true if the file size is within the configured limit.
   */
  isAllowedSize(sizeBytes: number | undefined): boolean {
    if (sizeBytes === undefined) return true;
    return sizeBytes >= 0 && sizeBytes <= this.maxFileSizeBytes;
  }
}
