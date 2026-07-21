function normalizeBasePath(basePath: string | undefined): string {
  const normalized = basePath?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return normalized ? `/${normalized}` : "";
}

export function withBasePath(path: string, basePath: string | undefined): string {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (!normalizedBasePath) return path;

  if (
    path === normalizedBasePath ||
    path.startsWith(`${normalizedBasePath}/`) ||
    path.startsWith(`${normalizedBasePath}?`) ||
    path.startsWith(`${normalizedBasePath}#`)
  ) {
    return path;
  }

  return `${normalizedBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildShareableUrl(
  origin: string,
  path: string,
  basePath: string | undefined,
): string {
  return `${origin.replace(/\/+$/g, "")}${withBasePath(path, basePath)}`;
}
