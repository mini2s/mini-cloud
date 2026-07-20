import {
  ApiError,
  DeleteConflictErrorBodySchema,
  parseWithFallback,
} from "@multica/core/api";
import type { DeleteConflictErrorBody } from "@multica/core/api";

export type DeleteConflictCode = DeleteConflictErrorBody["code"];

type DeleteConflictMessages = Partial<Record<DeleteConflictCode, string>>;

export function getDeleteConflictMessage(
  error: unknown,
  messages: DeleteConflictMessages,
): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;

  const body = parseWithFallback<DeleteConflictErrorBody | null>(
    error.body,
    DeleteConflictErrorBodySchema,
    null,
    { endpoint: "DELETE conflict response" },
  );
  if (!body) return null;

  return messages[body.code] ?? null;
}
