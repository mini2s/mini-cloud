/**
 * isValidGitRepoURL mirrors server/internal/handler/project_resource.go's
 * validator — keep them in sync. Accepts https/http/ssh/git URLs with a host,
 * and scp-like ssh shorthand `[user@]host:owner/repo.git`. Intentionally lax:
 * guards against pasted garbage, not a strict grammar (the real fetch is
 * `git clone`, which gives a clearer error than we can).
 */
export function isValidGitRepoURL(s: string): boolean {
  const str = s.trim();
  // scheme-based: http/https/ssh/git with a non-empty host
  try {
    const u = new URL(str);
    if (
      u.host &&
      (u.protocol === "http:" ||
        u.protocol === "https:" ||
        u.protocol === "ssh:" ||
        u.protocol === "git:")
    ) {
      return true;
    }
  } catch {
    // not a URL with a scheme — fall through to scp-like check
  }
  // scp-like ssh shorthand: [user@]host:path
  if (str.includes(" ") || str.includes("://")) return false;
  const colon = str.indexOf(":");
  if (colon <= 0 || colon === str.length - 1) return false;
  const at = str.indexOf("@");
  if (at >= colon) return false;
  const hostStart = at >= 0 ? at + 1 : 0;
  const host = str.slice(hostStart, colon);
  const path = str.slice(colon + 1);
  return host !== "" && path !== "";
}
