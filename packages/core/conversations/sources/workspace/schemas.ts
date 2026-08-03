import { z } from "zod";

const DeviceStatusSchema = z
  .enum(["online", "offline", ""])
  .catch("");

export const CostrictDeviceSchema = z
  .object({
    id: z.string().min(1),
    deviceId: z.string().min(1),
    displayName: z.string().optional(),
    platform: z.string().optional(),
    version: z.string().optional(),
    userId: z.string().optional(),
    workspaceId: z.string().nullish(),
    status: DeviceStatusSchema.nullish(),
    label: z.string().nullish(),
    description: z.string().nullish(),
    tokenRotatedAt: z.string().nullish(),
    lastConnectedAt: z.string().nullish(),
    lastSeenAt: z.string().nullish(),
    canUpdate: z.boolean().nullish(),
    latestVersion: z.string().nullish(),
    clusterAPIURL: z.string().nullish(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .loose();

export const CostrictWorkspaceDirectorySchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    name: z.string().optional(),
    path: z.string(),
    isDefault: z.boolean().optional(),
    orderIndex: z.number().optional(),
    settings: z.record(z.string(), z.unknown()).nullish(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .loose();

function tolerantList<T extends z.ZodType>(schema: T) {
  return z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const result = schema.safeParse(item);
      return result.success ? [result.data] : [];
    }),
  );
}

export const CostrictWorkspaceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().nullish(),
    userId: z.string().optional(),
    deviceId: z.string().nullish(),
    deviceUniqueId: z.string().nullish(),
    isDefault: z.boolean().optional(),
    status: z.enum(["active", "inactive", "archived"]).nullish(),
    deviceStatus: DeviceStatusSchema.nullish(),
    settings: z.record(z.string(), z.unknown()).nullish(),
    directories: tolerantList(CostrictWorkspaceDirectorySchema).nullish(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .loose();

export const CostrictDeviceListSchema = tolerantList(CostrictDeviceSchema);
export const CostrictWorkspaceListSchema = tolerantList(CostrictWorkspaceSchema);
