export type NotificationGroupKey =
  | "assignments"
  | "workflow_roles"
  | "status_changes"
  | "workflow_node_status"
  | "comments"
  | "updates"
  | "agent_activity"
  | "system_notifications";

export type NotificationGroupValue = "all" | "muted";

export type NotificationPreferences = Partial<Record<NotificationGroupKey, NotificationGroupValue>>;

export interface NotificationPreferenceResponse {
  workspace_id: string;
  preferences: NotificationPreferences;
}
