import { describe, it, expect } from "vitest";
import { parseIssueCommand } from "./issue-commands";

describe("parseIssueCommand", () => {
  describe("assign", () => {
    it("parses 分配给 @张三", () => {
      const result = parseIssueCommand("分配给 @张三");
      expect(result).toEqual({ type: "assign", target: "张三", targetType: "member" });
    });

    it("parses assign 给 agent-name", () => {
      const result = parseIssueCommand("assign 给 Code Reviewer");
      expect(result).toEqual({ type: "assign", target: "Code Reviewer", targetType: "member" });
    });

    it("parses 交给 开发小队", () => {
      const result = parseIssueCommand("交给 开发小队");
      expect(result).toEqual({ type: "assign", target: "开发", targetType: "squad" });
    });
  });

  describe("status", () => {
    it("parses 状态改为 in_review", () => {
      const result = parseIssueCommand("状态改为 in_review");
      expect(result).toEqual({ type: "status", status: "in_review" });
    });

    it("parses 标记为 done", () => {
      const result = parseIssueCommand("标记为 done");
      expect(result).toEqual({ type: "status", status: "done" });
    });

    it("parses 移到 backlog", () => {
      const result = parseIssueCommand("移到 backlog");
      expect(result).toEqual({ type: "status", status: "backlog" });
    });
  });

  describe("priority", () => {
    it("parses 优先级 P0", () => {
      const result = parseIssueCommand("优先级 P0");
      expect(result).toEqual({ type: "priority", priority: "urgent" });
    });

    it("parses 设为 urgent", () => {
      const result = parseIssueCommand("设为 urgent");
      expect(result).toEqual({ type: "priority", priority: "urgent" });
    });
  });

  describe("label", () => {
    it("parses 加 bug 标签", () => {
      const result = parseIssueCommand("加 bug 标签");
      expect(result).toEqual({ type: "label", operation: "add", label: "bug" });
    });

    it("parses 去掉 enhancement", () => {
      const result = parseIssueCommand("去掉 enhancement");
      expect(result).toEqual({ type: "label", operation: "remove", label: "enhancement" });
    });
  });

  describe("unknown", () => {
    it("returns unknown for unrecognized input", () => {
      const result = parseIssueCommand("帮我看看这个 issue 的进展");
      expect(result).toEqual({ type: "unknown" });
    });
  });
});
