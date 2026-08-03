import { parseWithFallback } from "../../../api/schema";
import type { z } from "zod";
import type { CostrictDevice, CostrictWorkspace } from "./types";
import {
  CostrictDeviceListSchema,
  CostrictWorkspaceListSchema,
} from "./schemas";

export const COSTRICT_WEB_PROXY_PREFIX = "/costrict-api";

function readCollection(raw: unknown, key: string): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return raw;
  return (raw as Record<string, unknown>)[key] ?? raw;
}

async function requestCollection(path: string, signal?: AbortSignal) {
  const response = await fetch(`${COSTRICT_WEB_PROXY_PREFIX}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`CoStrict API request failed: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function normalizeDevice(
  input: z.infer<typeof CostrictDeviceListSchema>[number],
): CostrictDevice {
  return {
    id: input.id,
    deviceId: input.deviceId,
    displayName: input.displayName ?? input.label ?? input.deviceId,
    platform: input.platform ?? "",
    version: input.version ?? "",
    userId: input.userId ?? "",
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    status: input.status ?? "",
    ...(input.label ? { label: input.label } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.tokenRotatedAt
      ? { tokenRotatedAt: input.tokenRotatedAt }
      : {}),
    ...(input.lastConnectedAt
      ? { lastConnectedAt: input.lastConnectedAt }
      : {}),
    ...(input.lastSeenAt ? { lastSeenAt: input.lastSeenAt } : {}),
    ...(input.canUpdate !== null && input.canUpdate !== undefined
      ? { canUpdate: input.canUpdate }
      : {}),
    ...(input.latestVersion ? { latestVersion: input.latestVersion } : {}),
    ...(input.clusterAPIURL
      ? { clusterAPIURL: input.clusterAPIURL }
      : {}),
    createdAt: input.createdAt ?? "",
    updatedAt: input.updatedAt ?? "",
  };
}

export async function fetchCostrictDevices(
  signal?: AbortSignal,
): Promise<CostrictDevice[]> {
  const raw = await requestCollection("/api/devices", signal);
  const parsed = parseWithFallback<z.infer<typeof CostrictDeviceListSchema>>(
    readCollection(raw, "devices"),
    CostrictDeviceListSchema,
    [],
    { endpoint: "GET /costrict-api/api/devices" },
  );
  return parsed.map(normalizeDevice);
}

export async function fetchCostrictWorkspaces(
  signal?: AbortSignal,
): Promise<CostrictWorkspace[]> {
  const raw = await requestCollection("/api/workspaces", signal);
  const parsed = parseWithFallback<z.infer<typeof CostrictWorkspaceListSchema>>(
    readCollection(raw, "workspaces"),
    CostrictWorkspaceListSchema,
    [],
    { endpoint: "GET /costrict-api/api/workspaces" },
  );
  return parsed.map((workspace) => ({
    id: workspace.id,
    name: workspace.name ?? workspace.id,
    ...(workspace.description
      ? { description: workspace.description }
      : {}),
    userId: workspace.userId ?? "",
    ...(workspace.deviceId ? { deviceId: workspace.deviceId } : {}),
    ...(workspace.deviceUniqueId
      ? { deviceUniqueId: workspace.deviceUniqueId }
      : {}),
    isDefault: workspace.isDefault ?? false,
    status: workspace.status ?? "active",
    deviceStatus: workspace.deviceStatus ?? "",
    ...(workspace.settings ? { settings: workspace.settings } : {}),
    directories: (workspace.directories ?? []).map((directory) => ({
      id: directory.id,
      workspaceId: directory.workspaceId ?? workspace.id,
      name: directory.name ?? directory.path,
      path: directory.path,
      isDefault: directory.isDefault ?? false,
      orderIndex: directory.orderIndex ?? 0,
      ...(directory.settings ? { settings: directory.settings } : {}),
      createdAt: directory.createdAt ?? "",
      updatedAt: directory.updatedAt ?? "",
    })),
    createdAt: workspace.createdAt ?? "",
    updatedAt: workspace.updatedAt ?? "",
  }));
}
