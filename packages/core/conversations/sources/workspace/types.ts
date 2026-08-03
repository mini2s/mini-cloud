export type CostrictDeviceStatus = "online" | "offline" | "";

export type CostrictDevice = {
  id: string;
  deviceId: string;
  displayName: string;
  platform: string;
  version: string;
  userId: string;
  workspaceId?: string;
  status: CostrictDeviceStatus;
  label?: string;
  description?: string;
  tokenRotatedAt?: string;
  lastConnectedAt?: string;
  lastSeenAt?: string;
  canUpdate?: boolean;
  latestVersion?: string;
  clusterAPIURL?: string;
  createdAt: string;
  updatedAt: string;
};

export type CostrictWorkspaceDirectory = {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  isDefault: boolean;
  orderIndex: number;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CostrictWorkspace = {
  id: string;
  name: string;
  description?: string;
  userId: string;
  deviceId?: string;
  deviceUniqueId?: string;
  isDefault: boolean;
  status: "active" | "inactive" | "archived";
  deviceStatus?: CostrictDeviceStatus;
  settings?: Record<string, unknown>;
  directories: CostrictWorkspaceDirectory[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceConversationSource = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  deviceRecordId: string;
  deviceId: string;
  deviceName: string;
  deviceStatus: CostrictDeviceStatus;
  workspaceDirectory: string;
  directoryLabel?: string;
  proxyBaseUrl: string;
};
