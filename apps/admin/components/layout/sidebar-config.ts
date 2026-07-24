// Single source of truth for the admin sidebar's nav structure.
// Each item maps to one route file under app/[workspaceSlug]/(dashboard)/.
// Adding a route = adding an entry here AND creating the page.tsx.

import {
  Home,
  MessageSquare,
  CheckSquare,
  Eye,
  FolderKanban,
  ListTodo,
  Palette,
  GitPullRequest,
  Settings2,
  Workflow,
  Users,
  Send,
  BookOpen,
  Wrench,
  Brain,
  Gauge,
  Gem,
  DollarSign,
  Target,
  Trophy,
  UserCog,
  ShieldCheck,
  Plug,
  Bell,
  Ruler,
  IdCard,
  CreditCard,
  BellRing,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  /** Route relative to current workspace, e.g. "/issues". Use "" for home. */
  href: string;
  /** zh-CN label (shown by default) */
  labelZh: string;
  /** en label */
  labelEn: string;
  icon: LucideIcon;
}

export interface NavGroup {
  id: string;
  labelZh: string;
  labelEn: string;
  items: NavItem[];
}

export const HOME_NAV: NavItem = {
  href: "",
  labelZh: "首页",
  labelEn: "Home",
  icon: Home,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workbench",
    labelZh: "工作台",
    labelEn: "Workbench",
    items: [
      { href: "/sessions", labelZh: "我的会话", labelEn: "Sessions", icon: MessageSquare },
      { href: "/tasks", labelZh: "我的任务", labelEn: "Tasks", icon: CheckSquare },
      { href: "/reviews", labelZh: "我的审查", labelEn: "Reviews", icon: Eye },
    ],
  },
  {
    id: "projects",
    labelZh: "项目",
    labelEn: "Projects",
    items: [
      { href: "/projects", labelZh: "项目总览", labelEn: "Overview", icon: FolderKanban },
      { href: "/projects/backlog", labelZh: "待办", labelEn: "Backlog", icon: ListTodo },
      { href: "/issues", labelZh: "需求", labelEn: "Issues", icon: ListTodo },
      { href: "/design", labelZh: "设计", labelEn: "Design", icon: Palette },
      { href: "/review", labelZh: "审查", labelEn: "Review", icon: GitPullRequest },
      { href: "/projects/settings", labelZh: "项目设置", labelEn: "Settings", icon: Settings2 },
    ],
  },
  {
    id: "collaboration",
    labelZh: "协同",
    labelEn: "Collaboration",
    items: [
      { href: "/workflows", labelZh: "工作流", labelEn: "Workflows", icon: Workflow },
      { href: "/squads", labelZh: "团队", labelEn: "Squads", icon: Users },
      { href: "/dispatch", labelZh: "任务委派", labelEn: "Dispatch", icon: Send },
    ],
  },
  {
    id: "repository",
    labelZh: "知识中心",
    labelEn: "Repository",
    items: [
      { href: "/wiki", labelZh: "知识", labelEn: "Wiki", icon: BookOpen },
      { href: "/skills", labelZh: "技能", labelEn: "Skills", icon: Wrench },
      { href: "/memory", labelZh: "记忆", labelEn: "Memory", icon: Brain },
    ],
  },
  {
    id: "metrics",
    labelZh: "效能度量",
    labelEn: "Metrics",
    items: [
      { href: "/metrics/efficiency", labelZh: "效能", labelEn: "Efficiency", icon: Gauge },
      { href: "/metrics/quality", labelZh: "质量", labelEn: "Quality", icon: Gem },
      { href: "/metrics/cost", labelZh: "成本", labelEn: "Cost", icon: DollarSign },
      { href: "/metrics/coverage", labelZh: "覆盖", labelEn: "Coverage", icon: Target },
      { href: "/metrics/contribution", labelZh: "贡献", labelEn: "Contribution", icon: Trophy },
    ],
  },
  {
    id: "admin",
    labelZh: "平台管理",
    labelEn: "Admin",
    items: [
      { href: "/admin/members", labelZh: "组织成员", labelEn: "Members", icon: UserCog },
      { href: "/admin/permissions", labelZh: "权限管理", labelEn: "Permissions", icon: ShieldCheck },
      { href: "/admin/connectors", labelZh: "集成", labelEn: "Connectors", icon: Plug },
      { href: "/admin/channels", labelZh: "通知渠道", labelEn: "Channels", icon: Bell },
      { href: "/admin/quotas", labelZh: "配额策略", labelEn: "Quotas", icon: Ruler },
    ],
  },
  {
    id: "me",
    labelZh: "个人中心",
    labelEn: "Me",
    items: [
      { href: "/me/profile?tab=profile", labelZh: "我的资料", labelEn: "Profile", icon: IdCard },
      { href: "/me/quota", labelZh: "我的配额", labelEn: "My Quota", icon: CreditCard },
      { href: "/me/notifications", labelZh: "我的通知", labelEn: "Notifications", icon: BellRing },
      { href: "/me/preferences?tab=preferences", labelZh: "偏好设置", labelEn: "Preferences", icon: SlidersHorizontal },
    ],
  },
];
