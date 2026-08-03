import { describe, expect, it } from "vitest";
import type { CostrictDevice, CostrictWorkspace } from "./types";
import { resolveWorkspaceConversationSources } from "./workspace-sources";

function device(input: Partial<CostrictDevice> = {}): CostrictDevice {
  return {
    id: "device-record-1",
    deviceId: "device/1",
    displayName: "Developer laptop",
    platform: "windows",
    version: "1.0.0",
    userId: "user-1",
    status: "online",
    createdAt: "",
    updatedAt: "",
    ...input,
  };
}

function workspace(
  input: Partial<CostrictWorkspace> = {},
): CostrictWorkspace {
  return {
    id: "costrict-workspace-1",
    name: "Multica",
    userId: "user-1",
    deviceId: "device-record-1",
    deviceUniqueId: "device/1",
    isDefault: true,
    status: "active",
    deviceStatus: "online",
    directories: [
      {
        id: "directory-1",
        workspaceId: "costrict-workspace-1",
        name: "Repository",
        path: "/work/multica",
        isDefault: true,
        orderIndex: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    createdAt: "",
    updatedAt: "",
    ...input,
  };
}

describe("resolveWorkspaceConversationSources", () => {
  it("preserves workspace, device, and directory as independent identities", () => {
    expect(
      resolveWorkspaceConversationSources([workspace()], [device()]),
    ).toEqual([
      {
        id: "costrict-workspace-1\ndevice-record-1\n/work/multica",
        workspaceId: "costrict-workspace-1",
        workspaceName: "Multica",
        deviceRecordId: "device-record-1",
        deviceId: "device/1",
        deviceName: "Developer laptop",
        deviceStatus: "online",
        workspaceDirectory: "/work/multica",
        directoryLabel: "Repository",
        proxyBaseUrl:
          "/costrict-api/cloud/device/device%2F1/proxy",
      },
    ]);
  });

  it("uses the device cluster API URL for cross-cluster proxy routing", () => {
    const [source] = resolveWorkspaceConversationSources(
      [workspace()],
      [device({ clusterAPIURL: "https://cluster.example.com/" })],
    );

    expect(source?.proxyBaseUrl).toBe(
      "https://cluster.example.com/cloud/device/device%2F1/proxy",
    );
  });

  it("orders default directories first and keeps offline devices visible", () => {
    const sources = resolveWorkspaceConversationSources(
      [
        workspace({
          deviceStatus: "offline",
          directories: [
            {
              id: "secondary",
              workspaceId: "costrict-workspace-1",
              name: "Secondary",
              path: "/secondary",
              isDefault: false,
              orderIndex: 0,
              createdAt: "",
              updatedAt: "",
            },
            {
              id: "primary",
              workspaceId: "costrict-workspace-1",
              name: "Primary",
              path: "/primary",
              isDefault: true,
              orderIndex: 10,
              createdAt: "",
              updatedAt: "",
            },
          ],
        }),
      ],
      [device({ status: "offline" })],
    );

    expect(sources.map((source) => source.workspaceDirectory)).toEqual([
      "/primary",
      "/secondary",
    ]);
    expect(sources.every((source) => source.deviceStatus === "offline")).toBe(
      true,
    );
  });

  it("does not infer devices from unrelated workspace data", () => {
    expect(resolveWorkspaceConversationSources([workspace()], [])).toEqual([]);
  });

  it("preserves the workspace API order and does not hide non-active records", () => {
    const sources = resolveWorkspaceConversationSources(
      [
        workspace({
          id: "inactive-workspace",
          name: "Inactive",
          status: "inactive",
        }),
        workspace({ id: "active-workspace", name: "Active" }),
      ],
      [device()],
    );

    expect(sources.map((source) => source.workspaceName)).toEqual([
      "Inactive",
      "Active",
    ]);
  });

  it("uses the workspace-associated device status shown by the original UI", () => {
    const [source] = resolveWorkspaceConversationSources(
      [workspace({ deviceStatus: "offline" })],
      [device({ status: "online" })],
    );

    expect(source?.deviceStatus).toBe("offline");
  });
});
