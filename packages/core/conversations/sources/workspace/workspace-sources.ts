import { COSTRICT_WEB_PROXY_PREFIX } from "./api";
import type {
  CostrictDevice,
  CostrictWorkspace,
  WorkspaceConversationSource,
} from "./types";

function proxyBaseUrl(device: CostrictDevice, deviceId: string): string {
  const clusterBase = device.clusterAPIURL?.replace(/\/$/, "");
  const base = clusterBase || COSTRICT_WEB_PROXY_PREFIX;
  return `${base}/cloud/device/${encodeURIComponent(deviceId)}/proxy`;
}

/**
 * Preserves the original product identity chain. A CoStrict Device is an
 * independent domain entity and must never be inferred from Multica runtime
 * metadata.
 */
export function resolveWorkspaceConversationSources(
  workspaces: readonly CostrictWorkspace[],
  devices: readonly CostrictDevice[],
): WorkspaceConversationSource[] {
  const sources: WorkspaceConversationSource[] = [];
  const orderedWorkspaces = [...workspaces];

  for (const workspace of orderedWorkspaces) {
    const device = devices.find(
      (candidate) =>
        candidate.id === workspace.deviceId ||
        candidate.deviceId === workspace.deviceUniqueId,
    );
    if (!device) continue;
    const deviceId = workspace.deviceUniqueId || device.deviceId;
    if (!deviceId) continue;

    const directories = [...workspace.directories].sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.orderIndex - b.orderIndex,
    );
    const candidates =
      directories.length > 0
        ? directories
        : [
            {
              id: "default",
              workspaceId: workspace.id,
              name: "",
              path: "",
              isDefault: true,
              orderIndex: 0,
              createdAt: "",
              updatedAt: "",
            },
          ];

    for (const directory of candidates) {
      sources.push({
        id: `${workspace.id}\n${device.id}\n${directory.path}`,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        deviceRecordId: device.id,
        deviceId,
        deviceName: device.displayName,
        deviceStatus: workspace.deviceStatus || device.status,
        workspaceDirectory: directory.path,
        ...(directory.name ? { directoryLabel: directory.name } : {}),
        proxyBaseUrl: proxyBaseUrl(device, deviceId),
      });
    }
  }

  return sources;
}
