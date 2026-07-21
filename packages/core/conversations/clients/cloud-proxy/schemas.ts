import { z } from "zod";

const OpenCodeRecordSchema = z.record(z.string(), z.unknown());

export const OpenCodeMessageInfoSchema = z
  .object({
    id: z.string().min(1),
    sessionID: z.string().optional(),
    role: z.string(),
    time: OpenCodeRecordSchema.optional(),
    error: z.unknown().optional(),
    finish: z.string().optional(),
  })
  .loose();

export const OpenCodePartSchema = z
  .object({
    id: z.string().optional(),
    sessionID: z.string().optional(),
    messageID: z.string().optional(),
    type: z.string(),
    callID: z.string().optional(),
  })
  .loose();

export const OpenCodeMessageWithPartsSchema = z
  .object({
    info: OpenCodeMessageInfoSchema,
    parts: z.array(OpenCodePartSchema).default([]),
  })
  .loose();

export const OpenCodeMessagesSchema = z.array(
  OpenCodeMessageWithPartsSchema,
);
export const OpenCodeSessionStatusSchema = z
  .object({ type: z.string() })
  .loose();
export const OpenCodeStatusMapSchema = z.record(
  z.string(),
  OpenCodeSessionStatusSchema,
);
export const OpenCodeOptionalRecordSchema = OpenCodeRecordSchema.nullable();
export const OpenCodeRecordArraySchema = z.array(OpenCodeRecordSchema);
export const OpenCodeTaskUsageSchema = z.object({
  total_tokens: z.number(),
  tool_uses: z.number(),
  duration_ms: z.number(),
});
export const OpenCodeTaskSnapshotSchema = z
  .object({
    taskID: z.string().min(1),
    toolUseID: z.string().optional(),
    status: z.string().optional(),
    description: z.string().optional(),
    taskType: z.string().optional(),
    summary: z.string().optional(),
    usage: OpenCodeTaskUsageSchema.optional(),
    startTime: z.number().optional(),
    endTime: z.number().optional(),
  })
  .loose();
export const OpenCodeTaskSnapshotArraySchema = z.array(
  OpenCodeTaskSnapshotSchema,
);

export const OpenCodeCanonicalEventSchema = z
  .object({
    type: z.string().min(1),
    properties: OpenCodeRecordSchema.default({}),
  })
  .loose();

export const OpenCodeWrappedEventSchema = z
  .object({
    directory: z.string().optional(),
    payload: OpenCodeCanonicalEventSchema,
  })
  .loose();
