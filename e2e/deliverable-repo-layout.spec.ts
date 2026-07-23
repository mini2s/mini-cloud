/**
 * Deliverable repo layout (Scheme A) — E2E against the REAL platform Gitea via
 * the e2e-workspace (http://localhost:3000/e2e-workspace). Verifies the readable,
 * CJK-preserving in-repo directory structure end to end:
 *
 *   nodes/<NN>-<nodeTitle>-<nodeRunShort>/<deliverableTitle>.md           (deliverable)
 *   nodes/<NN>-<nodeTitle>-<nodeRunShort>/reviews/<RR>-<reviewer>-通过.md  (review)
 *
 * Closed loop (no mocks): create a document-deliverable workflow + run → M2
 * scaffolds the Gitea org/repo/inst → bridge the node-run to awaiting_critic →
 * the REAL `cs-workflow gitea submit` clones/branches/pushes the doc to the NEW
 * path, opens a Gitea PR, reports it → approve → server merges the PR AND
 * ArchiveReviewComment archives the review opinion under the node dir → assert
 * the inst-branch tree holds both files at the readable paths.
 *
 * Skipped when Gitea is not configured (CI without Gitea). Requires the multica
 * stack + Gitea running + postgres reachable from the host.
 */
import { test, expect } from "@playwright/test";
import { createTestApi, loginAsDefault } from "./helpers";
import {
  giteaE2eEnabled, giteaApi, ensureCsWorkflowBinary, cleanupCsWorkflowArtifacts,
  runCsWorkflowSubmit, setNodeRunStatus, seedAgent, deleteAgent, dbQuery,
  prIndexFromUrl,
} from "./gitea";

const GITEA_ENABLED = giteaE2eEnabled();
const GITEA_URL = process.env.GITEA_BASE_URL || "http://127.0.0.1:23000";
const GITEA_ADMIN_TOKEN = process.env.GITEA_ADMIN_TOKEN || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short8 = (uuid: string) => uuid.replace(/-/g, "").slice(0, 8);
const pad2 = (n: number) => String(n).padStart(2, "0");

// Faithful TS mirror of gitea.sanitizePathSeg (topology.go): keep Unicode
// letters/digits + '.' + '_', everything else → '-', collapse runs, trim ends.
// Used only to build the path the agent writes — the Go side is source of truth.
function sanitizePathSeg(s: string): string {
  const b: string[] = [];
  for (const ch of s) {
    b.push(/[\p{L}\p{N}]/u.test(ch) || ch === "." || ch === "_" ? ch : "-");
  }
  const collapsed: string[] = [];
  for (const ch of b) {
    if (ch === "-" && collapsed[collapsed.length - 1] === "-") continue;
    collapsed.push(ch);
  }
  let res = collapsed.join("").replace(/^-+/, "").replace(/-+$/, "");
  if (res === "." || res === "..") return "";
  return res;
}
function nodeDir(seq: number, nodeTitle: string, nodeRunID: string): string {
  const title = sanitizePathSeg(nodeTitle);
  const short = short8(nodeRunID);
  return title ? `nodes/${pad2(seq)}-${title}-${short}` : `nodes/${pad2(seq)}-${short}`;
}
function deliverableFile(seq: number, nodeTitle: string, nodeRunID: string, delivTitle: string): string {
  let name = sanitizePathSeg(delivTitle);
  if (!name) name = "untitled";
  return `${nodeDir(seq, nodeTitle, nodeRunID)}/${name}.md`;
}

async function repoTree(owner: string, repo: string, branch: string): Promise<string[]> {
  const res = await fetch(
    `${GITEA_URL}/api/v1/repos/${owner}/${repo}/git/trees/${branch}?recursive=true`,
    { headers: { Authorization: `token ${GITEA_ADMIN_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`tree fetch ${owner}/${repo}/${branch}: ${res.status}`);
  const body = (await res.json()) as { tree?: { path: string; type: string }[] };
  return (body.tree ?? []).filter((e) => e.type === "blob").map((e) => e.path);
}

test.describe("deliverable repo layout (Scheme A)", () => {
  test.beforeAll(() => { if (GITEA_ENABLED) ensureCsWorkflowBinary(); });
  test.afterAll(() => { if (GITEA_ENABLED) cleanupCsWorkflowArtifacts(); });

  test("readable node dir + deliverable file + review archive via e2e-workspace", async ({ page }) => {
    test.skip(!GITEA_ENABLED, "needs GITEA_BASE_URL+ADMIN_TOKEN + reachable Gitea");
    test.setTimeout(300000);

    const api = await createTestApi();
    const slug = await loginAsDefault(page);
    const agents: string[] = [];
    try {
      const wsId = api.getWorkspaceId()!;
      const owner = `t-${short8(wsId)}`;

      const workerId = await seedAgent("layout-worker", wsId);
      const criticId = await seedAgent("layout-critic", wsId);
      agents.push(workerId, criticId);

      const NODE_TITLE = "需求分析";
      const DELIV_TITLE = "设计文档";
      const wf = await api.createWorkflow("Layout E2E");
      const repo = `wf-${short8(wf.id)}`;
      const node = await api.createWorkflowNode(wf.id, {
        title: NODE_TITLE,
        worker_type: "agent",
        worker_id: workerId,
        critic_type: "agent",
        critic_id: criticId,
      });
      const deliv = await api.createWorkflowNodeDeliverable(wf.id, node.id, {
        kind: "document",
        title: DELIV_TITLE,
        required: true,
      });
      await api.activateWorkflow(wf.id);

      const run = await api.startWorkflowRun(wf.id);
      const inst = `inst-${short8(run.id)}`;
      await sleep(12000); // scaffold + provision fire asynchronously on run start

      // ── 1. scaffold landed in Gitea ──
      expect((await giteaApi.orgExists(owner)).status).toBe(200);
      expect((await giteaApi.repoExists(owner, repo)).status).toBe(200);
      expect((await giteaApi.branchExists(owner, repo, inst)).status).toBe(200);

      // Bridge the node-run to critic-reviewable (no API path format_checking → awaiting_critic).
      const nrs = await api.listWorkflowNodeRuns(wf.id, run.id);
      const nr = nrs[0];
      await setNodeRunStatus(nr.id, "awaiting_critic");
      const nr8 = short8(nr.id);

      // sort_order drives <NN>; createWorkflowNode does not expose it.
      const seqRows = await dbQuery<{ sort_order: number }>(
        `SELECT sort_order FROM multica_workflow_node WHERE id = $1`, [node.id],
      );
      const seq = seqRows[0]?.sort_order ?? 0;
      const delivRelPath = deliverableFile(seq, NODE_TITLE, nr.id, DELIV_TITLE);
      const deliverablesJson = JSON.stringify([
        { deliverable_id: deliv.id, title: DELIV_TITLE, path: delivRelPath },
      ]);

      // ── 2. real cs-workflow submit: clone/branch/push the doc to the NEW path → PR ──
      const prUrl = runCsWorkflowSubmit({
        token: api.getToken()!,
        workspaceId: wsId,
        nodeRunId: nr.id,
        deliverableId: deliv.id,
        owner, repo,
        instBranch: inst,
        nodeBranch: `node/${pad2(seq)}-${nr8}`,
        deliverablesJson,
      });
      expect(prUrl, `cs-workflow should print a PR URL; got: ${prUrl}`).toMatch(/\/pulls\/\d+$/);
      const prIndex = prIndexFromUrl(prUrl);

      // ── 3. approve → server merges the PR + ArchiveReviewComment writes the review ──
      const rev = await api.reviewNodeRun(nr.id, { approved: true, comment: "结构清晰，通过。" });
      expect(rev.body?.status).toBe("completed");
      const prAfter = (await giteaApi.getPR(owner, repo, prIndex)).body as { merged?: boolean } | null;
      expect(prAfter?.merged).toBe(true);

      // ── 4. inst-branch tree: readable structure (deliverable + review co-located) ──
      const files = await repoTree(owner, repo, inst);
      const dir = nodeDir(seq, NODE_TITLE, nr.id);
      const reviewFiles = files.filter((f) => f.startsWith(`${dir}/reviews/`));

      expect(files, `inst tree:\n${files.join("\n")}`).toContain(delivRelPath);
      expect(reviewFiles, `reviews under ${dir}:\n${reviewFiles.join("\n")}`).toHaveLength(1);
      expect(reviewFiles[0]).toMatch(new RegExp(`/reviews/\\d{2}-[^/]+-通过\\.md$`));

      // ── 5. UI (localhost:3000/<slug>) renders the PR link ──
      await page.goto(`/${slug}/workflows/${wf.id}/runs/${run.id}`);
      await expect(page.locator(`a[href*="pulls/${prIndex}"]`)).toBeVisible({ timeout: 15000 });
    } finally {
      await api.cleanup();
      for (const id of agents) await deleteAgent(id);
    }
  });
});
