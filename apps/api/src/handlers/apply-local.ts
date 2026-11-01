/**
 * Apply Local handler — Insert review issues as inline comments in local source files.
 *
 * Takes a local repository path and a list of accepted review issues, and inserts
 * them as FIXME/TODO comments directly into the source files at the appropriate lines.
 */

export interface ApplyLocalRequest {
  readonly localPath: string;
  readonly issues: readonly any[];
}

export interface ApplyLocalResponse {
  success: boolean;
  error?: string;
}

export async function applyLocalHandler(
  request: ApplyLocalRequest
): Promise<ApplyLocalResponse> {
  const { localPath, issues } = request;

  if (!localPath || typeof localPath !== "string") {
    throw new Error('field "localPath" is required');
  }
  if (!issues || !Array.isArray(issues)) {
    throw new Error('field "issues" is required');
  }

  const fs = await import("fs/promises");
  const path = await import("path");

  // Resolve the repository root once; every target file must stay inside it.
  let rootDir: string;
  try {
    rootDir = await fs.realpath(path.resolve(localPath));
    if (!(await fs.stat(rootDir)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error('field "localPath" must be an existing directory');
  }

  const byFile = issues.reduce((acc: any, issue: any) => {
    if (!issue.accepted) return acc;
    if (!acc[issue.location.file]) acc[issue.location.file] = [];
    acc[issue.location.file].push(issue);
    return acc;
  }, {});

  for (const [file, fileIssues] of Object.entries(byFile)) {
    const fullPath = path.resolve(rootDir, file);
    try {
      // Reject traversal ("../x"), absolute paths and symlinks escaping the root
      const realPath = await fs.realpath(fullPath);
      const rel = path.relative(rootDir, realPath);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        console.warn(`Refusing to modify file outside repository root: ${file}`);
        continue;
      }
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) continue;

      const content = await fs.readFile(realPath, "utf8");
      const lines = content.split("\n");

      // Sort issues descending by line number so inserting doesn't mess up subsequent line numbers
      const sortedIssues = (fileIssues as any[]).sort(
        (a, b) => (b.location.line || 0) - (a.location.line || 0)
      );

      for (const issue of sortedIssues) {
        const lineNum = issue.location.line
          ? Math.max(1, issue.location.line) - 1
          : 0;
        const prefix =
          issue.severity === "critical" || issue.severity === "high"
            ? "FIXME"
            : "TODO";

        const commentLines = [
          `// ${prefix} [${issue.severity.toUpperCase()}]: ${issue.title} - ${issue.reason}`,
        ];
        if (issue.suggestion && issue.suggestion.description) {
          commentLines.push(`// Suggestion: ${issue.suggestion.description}`);
        }

        // Figure out indentation of the target line
        const targetLine = lines[lineNum] || "";
        const match = targetLine.match(/^(\s*)/);
        const indent = match ? match[1] : "";

        const indentedComments = commentLines.map((c) => indent + c);
        lines.splice(lineNum, 0, ...indentedComments);
      }

      await fs.writeFile(realPath, lines.join("\n"), "utf8");
    } catch (e) {
      console.warn(`Could not apply to file ${fullPath}:`, e);
      // skip missing files
    }
  }

  return {
    success: true,
  };
}
