export type IssueCommandAction =
  | { type: "assign"; target: string; targetType: "member" | "agent" | "squad" }
  | { type: "status"; status: string }
  | { type: "priority"; priority: string }
  | { type: "label"; operation: "add" | "remove"; label: string }
  | { type: "unknown" };

/**
 * Parse a Chinese/English NL issue command into a structured intent.
 * Used by the frontend for optimistic updates BEFORE sending to the API.
 * The backend has an equivalent Go implementation in CommandPromptBuilder.
 */
export function parseIssueCommand(input: string): IssueCommandAction {
  const normalized = input.trim();

  // Assign: "分配给 @张三" / "assign 给 智能体名" / "交给 小队名"
  const assignPatterns = [
    /分配给\s*(?:@)?(.+)/,
    /assign\s*(?:给)?\s*(?:@)?(.+)/i,
    /交给\s*(?:@)?(.+)/,
  ];
  for (const pattern of assignPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const target = match[1].trim();
      if (target.includes("小队") || target.includes("squad")) {
        return { type: "assign", target: target.replace(/小队|squad/, "").trim(), targetType: "squad" };
      }
      return { type: "assign", target, targetType: "member" };
    }
  }

  // Status: "状态改为 in_review" / "标记为 done" / "移到 backlog"
  const statusPattern = /(?:状态(?:改为|改成|设为)|标记为|标为|移到|move\s*to)\s*(.+)/;
  const statusMatch = normalized.match(statusPattern);
  if (statusMatch) {
    const raw = statusMatch[1].trim();
    const statusMap: Record<string, string> = {
      done: "done", 完成: "done", completed: "done", done: "done",
      in_review: "in_review", review: "in_review", 审核: "in_review",
      backlog: "backlog", 待办: "backlog",
      todo: "todo", 待处理: "todo",
      in_progress: "in_progress", progress: "in_progress", 进行中: "in_progress",
      cancelled: "cancelled", 取消: "cancelled",
    };
    const status = statusMap[raw.toLowerCase()] ?? raw.toLowerCase().replace(/\s+/g, "_");
    return { type: "status", status };
  }

  // Priority: "优先级 P0" / "设为 urgent"
  const priorityPattern = /(?:优先级|priority|设为|set\s*(?:to)?)\s*(.+)/i;
  const priorityMatch = normalized.match(priorityPattern);
  if (priorityMatch) {
    const raw = priorityMatch[1].trim();
    const priorityMap: Record<string, string> = {
      p0: "urgent", urgent: "urgent", 紧急: "urgent",
      p1: "high", high: "high", 高: "high",
      p2: "medium", medium: "medium", 中: "medium",
      p3: "low", low: "low", 低: "low",
    };
    const priority = priorityMap[raw.toLowerCase()] ?? raw.toLowerCase();
    return { type: "priority", priority };
  }

  // Label: "加 bug 标签" / "去掉 enhancement"
  const addLabelPattern = /(?:加|add|添加)\s*(.+?)(?:\s*(?:标签|label|tag))?$/;
  const removeLabelPattern = /(?:去掉|移除|删除|remove|delete)\s*(.+?)(?:\s*(?:标签|label|tag))?$/;

  const addMatch = normalized.match(addLabelPattern);
  if (addMatch) {
    return { type: "label", operation: "add", label: addMatch[1].trim() };
  }
  const removeMatch = normalized.match(removeLabelPattern);
  if (removeMatch) {
    return { type: "label", operation: "remove", label: removeMatch[1].trim() };
  }

  return { type: "unknown" };
}
