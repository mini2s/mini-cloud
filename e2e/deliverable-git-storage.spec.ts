/**
 * Deliverable git-storage (PR #88) — end-to-end against a REAL platform Gitea.
 *
 * Covers the full closed loop with no mocks:
 *   1. create a document-deliverable workflow + run
 *   2. M2 auto-scaffolds the Gitea org/repo/inst + auto-provisions the bot
 *      (PAT in workspace.settings + bot added to the org team)
 *   3. the REAL `cs-workflow gitea submit` CLI clones, branches, pushes the
 *      doc, opens a Gitea PR, and registers it via report-pr
 *   4. critic approve → server merges the PR (M2) → node completed + submission approved
 *   5. NodeRunCard renders the PR link (Task6)
 *
 * Plus a Task1 test: inline content upload for document deliverables is 422'd
 * when Gitea is configured, while a bare pull_request_url is still accepted.
 *
 * Skipped entirely when GITEA_BASE_URL/GITEA_ADMIN_TOKEN are unset or Gitea is
 * unreachable (CI without Gitea). Requires the multica stack + Gitea running
 * (docker-compose.local.yml) + postgres reachable from the host for DB asserts.
 */
import { test, expect } from "@playwright/test";
import { createTestApi, loginAsDefault } from "./helpers";
import {
  giteaE2eEnabled, giteaApi, ensureCsWorkflowBinary, cleanupCsWorkflowArtifacts,
  runCsWorkflowSubmit, setNodeRunStatus, getWorkspaceSettings, getSubmission,
  seedAgent, deleteAgent, prIndexFromUrl,
} from "./gitea";

const GITEA_ENABLED = giteaE2eEnabled();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Gitea topology derives names from the first 8 hex of a UUID (see gitea.shortHex).
const short8 = (uuid: string) => uuid.replace(/-/g, "").slice(0, 8);

test.describe("deliverable git-storage (PR #88)", () => {
  test.beforeAll(() => { if (GITEA_ENABLED) ensureCsWorkflowBinary(); });
  test.afterAll(() => { if (GITEA_ENABLED) cleanupCsWorkflowArtifacts(); });

  test("real closed loop: scaffold → cs-workflow push/PR → approve merge → UI link", async ({ page }) => {
    test.skip(!GITEA_ENABLED, "needs GITEA_BASE_URL+ADMIN_TOKEN + reachable Gitea + multica_default network");
    test.setTimeout(300000);

    const api = await createTestApi();
    const slug = await loginAsDefault(page);
    const agents: string[] = [];
    try {
      const wsId = api.getWorkspaceId()!;
      const ws8 = short8(wsId);
      const owner = `t-${ws8}`;

      // worker + critic agents (seeded directly — they never run; the test
      // bridges the node-run to awaiting_critic via SQL).
      const workerId = await seedAgent("e2e-worker", wsId);
      const criticId = await seedAgent("e2e-critic", wsId);
      agents.push(workerId, criticId);

      const wf = await api.createWorkflow("Doc E2E closed loop");
      const repo = `wf-${short8(wf.id)}`;
      const node = await api.createWorkflowNode(wf.id, {
        title: "Authoring",
        worker_type: "agent",
        worker_id: workerId,
        critic_type: "agent",
        critic_id: criticId,
      });
      const deliv = await api.createWorkflowNodeDeliverable(wf.id, node.id, {
        kind: "document",
        title: "Design Doc",
        required: true,
      });
      await api.activateWorkflow(wf.id);

      const run = await api.startWorkflowRun(wf.id);
      const inst = `inst-${short8(run.id)}`;

      // M2 scaffold + provision fire asynchronously on run start.
      await sleep(12000);

      // ── 1. scaffold landed in Gitea ──
      expect((await giteaApi.orgExists(owner)).status).toBe(200);
      expect((await giteaApi.repoExists(owner, repo)).status).toBe(200);
      expect((await giteaApi.branchExists(owner, repo, inst)).status).toBe(200);

      // ── 2. bot auto-provisioned: PAT persisted + bot is an org member ──
      const settings = await getWorkspaceSettings(wsId);
      expect(settings.gitea_pat).toBeTruthy();
      expect((await giteaApi.orgMembers(owner)).map((m) => m.login)).toContain(`mc-bot-${ws8}`);

      // Bridge the node-run to critic-reviewable (StartWorkflowRun does not
      // dispatch; there is no API path format_checking → awaiting_critic).
      const nrs = await api.listWorkflowNodeRuns(wf.id, run.id);
      const nr = nrs[0];
      await setNodeRunStatus(nr.id, "awaiting_critic");
      const nr8 = short8(nr.id);
      const deliv8 = short8(deliv.id);
      const deliverablesJson = JSON.stringify([
        { deliverable_id: deliv.id, title: "Design Doc", path: `nodes/${nr8}/${deliv8}.md` },
      ]);

      // ── 3. real cs-workflow submit: clone/branch/push/PR/report ──
      const prUrl = runCsWorkflowSubmit({
        token: api.getToken()!,
        workspaceId: wsId,
        nodeRunId: nr.id,
        deliverableId: deliv.id,
        owner,
        repo,
        instBranch: inst,
        nodeBranch: `node/${nr8}`,
        deliverablesJson,
      });
      expect(prUrl, `cs-workflow should print a PR URL; got: ${prUrl}`).toMatch(/\/pulls\/\d+$/);
      const prIndex = prIndexFromUrl(prUrl);

      // submission registered with the PR URL
      const sub = await getSubmission(nr.id, deliv.id);
      expect(sub?.pull_request_url).toBe(prUrl);
      expect(sub?.status).toBe("submitted");

      // Gitea has the node branch + an open, unmerged PR
      expect((await giteaApi.branchExists(owner, repo, `node/${nr8}`)).status).toBe(200);
      const prBefore = (await giteaApi.getPR(owner, repo, prIndex)).body as { state?: string; merged?: boolean } | null;
      expect(prBefore?.state).toBe("open");
      expect(prBefore?.merged).toBe(false);

      // ── 4. approve → M2 merges the PR server-side ──
      const rev = await api.reviewNodeRun(nr.id, { approved: true, comment: "lgtm" });
      expect(rev.body?.status).toBe("completed");
      const prAfter = (await giteaApi.getPR(owner, repo, prIndex)).body as { merged?: boolean } | null;
      expect(prAfter?.merged).toBe(true);
      expect((await getSubmission(nr.id, deliv.id))?.status).toBe("approved");

      // ── 5. UI renders the PR link in NodeRunCard ──
      await page.goto(`/${slug}/workflows/${wf.id}/runs/${run.id}`);
      await expect(page.locator(`a[href*="pulls/${prIndex}"]`)).toBeVisible({ timeout: 15000 });
    } finally {
      await api.cleanup();
      for (const id of agents) await deleteAgent(id);
    }
  });

  test("document content upload rejected when Gitea configured; PR URL accepted (Task1)", async () => {
    test.skip(!GITEA_ENABLED, "needs Gitea configured");
    test.setTimeout(120000);

    const api = await createTestApi();
    const agents: string[] = [];
    try {
      const wsId = api.getWorkspaceId()!;
      const workerId = await seedAgent("e2e-worker-up", wsId);
      const criticId = await seedAgent("e2e-critic-up", wsId);
      agents.push(workerId, criticId);

      const wf = await api.createWorkflow("Doc E2E upload gate");
      const node = await api.createWorkflowNode(wf.id, {
        title: "N",
        worker_type: "agent",
        worker_id: workerId,
        critic_type: "agent",
        critic_id: criticId,
      });
      const deliv = await api.createWorkflowNodeDeliverable(wf.id, node.id, {
        kind: "document",
        title: "D",
        required: true,
      });
      await api.activateWorkflow(wf.id);
      const run = await api.startWorkflowRun(wf.id);
      const nr = (await api.listWorkflowNodeRuns(wf.id, run.id))[0];

      // content upload for document → 422 (disabled when Gitea configured)
      const r1 = await api.submitDeliverable(nr.id, deliv.id, { content: "# doc body" });
      expect(r1.status).toBe(422);

      // pull_request_url-only → 200 (the pointer stays allowed)
      const r2 = await api.submitDeliverable(nr.id, deliv.id, { pull_request_url: "http://gitea.local/o/r/pulls/1" });
      expect(r2.status).toBe(200);
    } finally {
      await api.cleanup();
      for (const id of agents) await deleteAgent(id);
    }
  });
});
