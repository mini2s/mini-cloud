import { z } from "zod";

export const IssueConversationSessionResponseSchema = z
  .object({
    conversation_id: z.string().min(1),
    workspace_directory: z.string().min(1),
    proxy_base_url: z.string().min(1),
  })
  .loose();

export type IssueConversationSessionResponse = z.infer<
  typeof IssueConversationSessionResponseSchema
>;
