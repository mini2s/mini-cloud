// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowActorSlot } from "./workflow-actor-slots";

type TestIdentity = {
  type: "agent" | "member" | "squad" | "role" | "api";
  id: string | null;
  name: string;
  typeLabel: string;
  initials?: string;
  avatarUrl?: string | null;
  availability?: "online" | "offline" | "unstable" | null;
  availabilityLabel?: string;
};

function renderSlot(identity: TestIdentity | null, fallback = "未配置") {
  render(
    <WorkflowActorSlot
      slot="worker"
      label="执行者"
      fallback={fallback}
      state={identity ? "configured" : "missing"}
      identity={identity}
    />,
  );
}

describe("WorkflowActorSlot", () => {
  it("renders an agent avatar, entity type, and explicit online status", () => {
    renderSlot({
      type: "agent",
      id: "agent-1",
      name: "研发助手 Alpha",
      typeLabel: "数智人",
      initials: "RA",
      avatarUrl: "/alpha.png",
      availability: "online",
      availabilityLabel: "在线",
    });

    const slot = screen.getByText("研发助手 Alpha").closest('[data-workflow-actor-slot="worker"]');
    expect(slot).toHaveAttribute("data-workflow-actor-type", "agent");
    expect(slot).toHaveAttribute("data-workflow-actor-availability", "online");
    expect(screen.getByRole("img", { name: "研发助手 Alpha" })).toBeInTheDocument();
    expect(slot).toHaveTextContent("数智人");
    expect(slot).toHaveTextContent("在线");
    expect(slot?.querySelector("[data-workflow-actor-state]")).not.toBeInTheDocument();
  });

  it("renders unstable agents with the supplied offline label", () => {
    renderSlot({
      type: "agent",
      id: "agent-2",
      name: "研发助手 Beta",
      typeLabel: "数智人",
      initials: "RB",
      availability: "unstable",
      availabilityLabel: "离线",
    });

    const slot = screen.getByText("研发助手 Beta").closest('[data-workflow-actor-slot="worker"]');
    expect(slot).toHaveAttribute("data-workflow-actor-availability", "unstable");
    expect(slot).toHaveTextContent("离线");
    expect(slot?.querySelector('[data-workflow-availability-icon="offline"]')).toBeInTheDocument();
  });

  it("uses initials when a member has no avatar", () => {
    renderSlot({
      type: "member",
      id: "member-1",
      name: "黄舟",
      typeLabel: "成员",
      initials: "HZ",
      avatarUrl: null,
    });

    expect(screen.getByText("HZ")).toBeInTheDocument();
    expect(screen.getByText("成员")).toBeInTheDocument();
    expect(screen.queryByText("在线")).not.toBeInTheDocument();
  });

  it("keeps squad identity square and omits availability", () => {
    renderSlot({
      type: "squad",
      id: "squad-1",
      name: "支付研发小队",
      typeLabel: "小队",
      initials: "PR",
      avatarUrl: null,
    });

    const slot = screen.getByText("支付研发小队").closest('[data-workflow-actor-slot="worker"]');
    const avatar = slot?.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveClass("rounded-md");
    expect(screen.getByText("小队")).toBeInTheDocument();
    expect(screen.queryByText("在线")).not.toBeInTheDocument();
  });

  it.each([
    ["role", "研发角色", "role"],
    ["api", "API 审核者", "api"],
  ] as const)("renders the %s identity glyph", (type, typeLabel, glyph) => {
    renderSlot({
      type,
      id: null,
      name: type === "role" ? "tech_lead" : "API review",
      typeLabel,
    });

    expect(screen.getByText(typeLabel)).toBeInTheDocument();
    expect(screen.getByTestId(`workflow-actor-glyph-${glyph}`)).toBeInTheDocument();
  });

  it("renders missing state as text and an empty glyph without a colored dot", () => {
    renderSlot(null);

    const slot = screen.getByText("未配置").closest('[data-workflow-actor-slot="worker"]');
    expect(screen.getByTestId("workflow-actor-glyph-empty")).toBeInTheDocument();
    expect(slot?.querySelector("[data-workflow-actor-state]")).not.toBeInTheDocument();
  });
});
