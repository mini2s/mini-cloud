/**
 * Centralized URL path builder. All navigation in shared packages (packages/views)
 * MUST go through this module — no hardcoded string paths.
 *
 * Two kinds of paths:
 *  - workspace-scoped: paths.workspace(slug).xxx() — carry workspace in URL
 *  - global: paths.login(), paths.newWorkspace(), paths.invite(id) — pre-workspace routes
 *
 * Why pure functions + builder pattern:
 *  - Changing a route shape (e.g. adding workspace slug prefix) becomes a single-file edit
 *  - IDs are always URL-encoded here so callers can't forget
 *  - Zero runtime deps means this module is safe in Node (tests) and browsers
 */

const encode = (id: string) => encodeURIComponent(id);

function workspaceScoped(slug: string) {
  const ws = `/${encode(slug)}`;
  return {
    root: () => `${ws}/issues`,
    usage: () => `${ws}/usage`,
    issues: () => `${ws}/issues`,
    issueDetail: (id: string) => `${ws}/issues/${encode(id)}`,
    projects: () => `${ws}/projects`,
    projectDetail: (id: string) => `${ws}/projects/${encode(id)}`,
    autopilots: () => `${ws}/autopilots`,
    autopilotDetail: (id: string) => `${ws}/autopilots/${encode(id)}`,
    agents: () => `${ws}/agents`,
    agentDetail: (id: string) => `${ws}/agents/${encode(id)}`,
    members: () => `${ws}/members`,
    memberDetail: (id: string) => `${ws}/members/${encode(id)}`,
    squads: () => `${ws}/squads`,
    squadDetail: (id: string) => `${ws}/squads/${encode(id)}`,
    inbox: () => `${ws}/inbox`,
    myIssues: () => `${ws}/my-issues`,
    runtimes: () => `${ws}/runtimes`,
    runtimeDetail: (id: string) => `${ws}/runtimes/${encode(id)}`,
    skills: () => `${ws}/skills`,
    skillDetail: (id: string) => `${ws}/skills/${encode(id)}`,
    workflows: () => `${ws}/workflows`,
    workflowDetail: (id: string) => `${ws}/workflows/${encode(id)}`,
    workflowRuns: (id: string) => `${ws}/workflows/${encode(id)}/runs`,
    workflowRunDetail: (workflowId: string, runId: string) => `${ws}/workflows/${encode(workflowId)}/runs/${encode(runId)}`,
    settings: () => `${ws}/settings`,
    // Efficiency settings/ops shell — one sidebar entry that surfaces the
    // eight efficiency sub-pages (pricing / datasources / sync / config +
    // platform overview / health / realtime / realtime query) via tabs. The
    // eight sub-routes below stay reachable directly for deep-linking.
    efficiencySettings: () => `${ws}/settings/efficiency`,
    roles: () => `${ws}/roles`,
    attachmentPreview: (id: string) => `${ws}/attachments/${encode(id)}/preview`,
    // Upcoming product surface — placeholder pages, web-only for now.
    home: () => `${ws}/home`,
    sessions: () => `${ws}/sessions`,
    reviews: () => `${ws}/reviews`,
    hub: () => `${ws}/hub`,
    hubSkill: () => `${ws}/hub?type=skill`,
    hubSubagent: () => `${ws}/hub?type=subagent`,
    hubCommand: () => `${ws}/hub?type=command`,
    hubMcp: () => `${ws}/hub?type=mcp`,
    hubPlugin: () => `${ws}/hub?type=plugin`,
    hubManager: () => `${ws}/hub/manager`,
    hubDetail: (id: string) => `${ws}/hub/${encode(id)}`,
    hubEditor: () => `${ws}/hub/editor`,
    hubEditorItem: (id: string) => `${ws}/hub/editor/${encode(id)}`,
    dispatch: () => `${ws}/dispatch`,
    wiki: () => `${ws}/wiki`,
    memory: () => `${ws}/memory`,
    metricsOverview: () => `${ws}/metrics`,
    metricsEfficiency: () => `${ws}/metrics/efficiency`,
    metricsQuality: () => `${ws}/metrics/quality`,
    metricsCost: () => `${ws}/metrics/cost`,
    metricsCoverage: () => `${ws}/metrics/coverage`,
    metricsContribution: () => `${ws}/metrics/contribution`,
    metricsNeeds: () => `${ws}/metrics/needs`,
    metricsTasks: () => `${ws}/metrics/tasks`,
    metricsCommits: () => `${ws}/metrics/commits`,
    // Efficiency drill-down detail pages. These are parametric (each takes the
    // entity id), so they're NOT part of the parameterless sidebar set — they're
    // used by dimension rankings/list views to push into a detail page.
    //   - repoAddr / needId carry slashes and map to catch-all routes
    //     ([...addr] / [...needId]); each path segment is encoded independently
    //     so a slash-bearing id round-trips correctly through Next.js params.
    //   - branch (repo only) is optional; when present it appends an extra
    //     segment (branches may themselves contain slashes → also split+encode).
    metricsUserDetail: (userId: string) => `${ws}/metrics/user/${encode(userId)}`,
    metricsUserGroupDetail: (groupId: string) =>
      `${ws}/metrics/user/group/${encode(groupId)}`,
    metricsRepoDetail: (repoAddr: string, branch?: string) => {
      const addrPath = repoAddr.split("/").map(encode).join("/");
      const branchPath = branch
        ? `/${branch.split("/").map(encode).join("/")}`
        : "";
      return `${ws}/metrics/repo/${addrPath}${branchPath}`;
    },
    metricsProjectDetail: (projectId: string) =>
      `${ws}/metrics/project/${encode(projectId)}`,
    metricsNeedDetail: (needId: string) =>
      `${ws}/metrics/need/${needId.split("/").map(encode).join("/")}`,
    metricsTaskDetail: (taskId: string) => `${ws}/metrics/task/${encode(taskId)}`,
    metricsWorkdirDetail: (workDirId: string) =>
      `${ws}/metrics/workdir/${workDirId.split("/").map(encode).join("/")}`,
    metricsCommitDetail: (commitId: string) =>
      `${ws}/metrics/commit/${encode(commitId)}`,
    permissions: () => `${ws}/permissions`,
    devices: () => `${ws}/devices`,
    connectors: () => `${ws}/connectors`,
    channels: () => `${ws}/channels`,
    quotas: () => `${ws}/quotas`,
    meProfile: () => `${ws}/me/profile`,
    meQuota: () => `${ws}/me/quota`,
    meNotifications: () => `${ws}/me/notifications`,
    meDevices: () => `${ws}/me/devices`,
  };
}

export const paths = {
  workspace: workspaceScoped,

  // Global (pre-workspace) routes
  login: () => "/login",
  newWorkspace: () => "/workspaces/new",
  invite: (id: string) => `/invite/${encode(id)}`,
  invitations: () => "/invitations",
  authCallback: () => "/auth/callback",
  root: () => "/",
};

export type WorkspacePaths = ReturnType<typeof workspaceScoped>;

// Prefixes — not slug names — because we match against full URL paths.
// A path is global if it equals or begins with any of these.
// Note: `/workspaces/` (trailing slash) is the prefix — `workspaces` is reserved,
// so any path starting with `/workspaces/...` is system-owned, not user-owned.
const GLOBAL_PREFIXES = ["/login", "/workspaces/", "/invite/", "/invitations", "/onboarding", "/auth/", "/logout", "/signup"];

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some((p) => path === p || path.startsWith(p));
}
