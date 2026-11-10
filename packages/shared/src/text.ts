/**
 * Slash trimming without regex: `/\/+$/` backtracks quadratically on inputs
 * like "////…x" (ReDoS), and these run on user-supplied URLs and paths.
 */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}

export function trimSlashes(s: string): string {
  let start = 0;
  while (start < s.length && s[start] === "/") start++;
  return trimTrailingSlashes(s.slice(start));
}
