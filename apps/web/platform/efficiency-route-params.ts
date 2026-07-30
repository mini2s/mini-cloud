const NEED_ROUTE_MARKER = "/metrics/need/";
const TASK_ROUTE_MARKER = "/metrics/task/";

function decodePathValue(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export function resolveNeedIdFromPathname(
  pathname: string,
  routeParam: string | string[],
): string {
  return resolveEfficiencyDetailId(pathname, NEED_ROUTE_MARKER, routeParam);
}

export interface RepoDetailRouteParams {
  repoAddr: string;
  repoBranch?: string;
}

export function resolveRepoParams(
  routeParams: string[],
): RepoDetailRouteParams {
  const repoAddr = decodePathValue(routeParams[0] ?? "");
  const repoBranch = routeParams[1]
    ? decodePathValue(routeParams[1])
    : undefined;
  return repoBranch ? { repoAddr, repoBranch } : { repoAddr };
}

export function resolveTaskIdFromPathname(
  pathname: string,
  routeParam: string,
): string {
  return resolveEfficiencyDetailId(pathname, TASK_ROUTE_MARKER, routeParam);
}

function resolveEfficiencyDetailId(
  pathname: string,
  routeMarker: string,
  routeParam: string | string[],
): string {
  const markerIndex = pathname.indexOf(routeMarker);
  if (markerIndex >= 0) {
    const pathValue = pathname.slice(markerIndex + routeMarker.length);
    if (pathValue.length > 0) return decodePathValue(pathValue);
  }

  return Array.isArray(routeParam) ? routeParam.join("/") : routeParam;
}
