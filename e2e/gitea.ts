/**
 * Helpers for the deliverable git-storage E2E test (PR #88).
 *
 * - giteaApi: read state from the REAL platform Gitea (org/repo/branch/PR/
 *   members) via a workspace bot token. The suite skips when GITEA_BASE_URL or
 *   GITEA_BOT_TOKEN are unset, or Gitea is unreachable.
 * - runCsWorkflowSubmit: spawn the REAL `cs-workflow gitea submit` CLI inside
 *   a container on the multica network (so it reaches gitea:3000 + backend:8080
 *   by container DNS, exactly like a daemon-spawned agent). Cross-compiles the
 *   linux binary once and mounts it, so each invocation only runs `git` ops +
 *   HTTP - no per-test `go build`.
 * - dbQuery / setNodeRunStatus / getWorkspaceSettings / getSubmission: direct
 *   pg access for the state-machine bridge (node-run has no API path from
 *   format_checking -> awaiting_critic) and for asserting on server-side state.
 */
import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const GITEA_URL = process.env.GITEA_BASE_URL || "http://127.0.0.1:23000";
const GITEA_BOT_TOKEN = process.env.GITEA_BOT_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://multica:multica@localhost:5432/multica?sslmode=disable";
const REPO_ROOT = path.resolve(E2E_DIR, "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const CACHE_DIR = path.join(E2E_DIR, ".cache");
const CS_BINARY = path.join(CACHE_DIR, "cs-workflow-linux");
const DOC_FILE = path.join(SERVER_DIR, "cs-e2e-doc.md");
const GO_MOD_CACHE = process.env.GITEA_E2E_GO_MOD_CACHE || ""; // optional host go mod cache mount

/** Skip the suite unless Gitea env is configured. Reachability is exercised
 *  inside the tests (a down Gitea surfaces as a real failure, not a silent
 *  skip). Kept sync because it runs at module load. */
export function giteaE2eEnabled(): boolean {
  return !!(process.env.GITEA_BASE_URL && GITEA_BOT_TOKEN);
}

async function giteaFetch(p: string, init: RequestInit = {}) {
  const res = await fetch(`${GITEA_URL}/api/v1${p}`, {
    ...init,
    headers: { Authorization: `token ${GITEA_BOT_TOKEN}`, ...(init.headers as Record<string, string>) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export const giteaApi = {
  currentUser: () => giteaFetch("/user"),
  repoExists: (org: string, repo: string) => giteaFetch(`/repos/${org}/${repo}`),
  branchExists: (org: string, repo: string, branch: string) =>
    giteaFetch(`/repos/${org}/${repo}/branches/${branch}`),
  getPR: (org: string, repo: string, index: number) => giteaFetch(`/repos/${org}/${repo}/pulls/${index}`),
};

async function requireGiteaOK(action: string, res: Awaited<ReturnType<typeof giteaFetch>>) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${action}: status ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function createGiteaDocumentPR(opts: {
  owner: string;
  repo: string;
  instBranch: string;
  nodeBranch: string;
  path: string;
  content: string;
  title: string;
}): Promise<string> {
  const branchRes = await giteaFetch(`/repos/${opts.owner}/${opts.repo}/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      new_branch_name: opts.nodeBranch,
      old_branch_name: opts.instBranch,
    }),
  });
  if (branchRes.status !== 409) {
    await requireGiteaOK("create branch", branchRes);
  }

  await requireGiteaOK("create file", await giteaFetch(
    `/repos/${opts.owner}/${opts.repo}/contents/${encodeURIComponent(opts.path)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch: opts.nodeBranch,
        message: `deliverable: ${opts.title}`,
        content: Buffer.from(opts.content, "utf8").toString("base64"),
      }),
    },
  ));

  const pull = await requireGiteaOK("create pull request", await giteaFetch(
    `/repos/${opts.owner}/${opts.repo}/pulls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base: opts.instBranch,
        head: opts.nodeBranch,
        title: opts.title,
      }),
    },
  )) as { html_url?: string; url?: string };
  if (!pull.html_url && !pull.url) {
    throw new Error(`create pull request: missing URL in ${JSON.stringify(pull)}`);
  }
  return pull.html_url ?? pull.url!;
}

export async function dbQuery<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client(DATABASE_URL);
  await client.connect();
  try {
    const r = await client.query(sql, params as never);
    return r.rows as T[];
  } finally {
    await client.end();
  }
}

export async function setNodeRunStatus(nodeRunId: string, status: string) {
  await dbQuery(`UPDATE multica_workflow_node_run SET status = $1 WHERE id = $2`, [status, nodeRunId]);
}

export async function getWorkspaceSettings(workspaceId: string): Promise<Record<string, unknown>> {
  const rows = await dbQuery<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM multica_workspace WHERE id = $1`, [workspaceId],
  );
  return rows[0]?.settings ?? {};
}

export async function getSubmission(nodeRunId: string, deliverableId: string) {
  const rows = await dbQuery(
    `SELECT status, pull_request_url FROM multica_workflow_node_deliverable_submission
     WHERE workflow_node_run_id = $1 AND deliverable_id = $2`, [nodeRunId, deliverableId],
  );
  return rows[0] as { status: string; pull_request_url: string } | undefined;
}

export async function seedAgent(name: string, workspaceId: string): Promise<string> {
  // Worker/critic agents only need to exist for the node config; they don't run
  // (the test bridges the node-run to awaiting_critic via SQL). Seed directly
  // to avoid the createAgent runtime requirement.
  const rows = await dbQuery<{ id: string }>(
    `INSERT INTO multica_agent (id, workspace_id, name, description, model, visibility, runtime_mode, is_builtin, created_at, updated_at)
     VALUES ($1, $2, $3, 'e2e', 'gpt-4o', 'workspace', 'cloud', false, now(), now())
     RETURNING id`, [cryptoRandomUuid(), workspaceId, name],
  );
  return rows[0].id;
}

export async function deleteAgent(id: string) {
  await dbQuery(`DELETE FROM multica_agent WHERE id = $1`, [id]);
}

function cryptoRandomUuid(): string {
  // Node 18+ has global crypto.randomUUID; fall back just in case.
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "00000000-0000-4000-8000-000000000000".replace(/0/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );
}

/** Cross-compile the cs-workflow linux binary once (mounted into the run
 *  container so each submit is fast - no per-test go build). Always (re)writes
 *  the doc file: docker -v turns a missing host path into a directory, which
 *  breaks cs-workflow's --file read. */
export function ensureCsWorkflowBinary() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // docker -v may have left DOC_FILE as a directory (when the host path didn't
  // exist, docker mounts a directory); clear it so writeFileSync succeeds.
  if (fs.existsSync(DOC_FILE) && fs.statSync(DOC_FILE).isDirectory()) {
    fs.rmSync(DOC_FILE, { recursive: true, force: true });
  }
  fs.writeFileSync(DOC_FILE, "# Design Doc\n\nE2E real closed-loop (cs-workflow submit).\n");
  if (fs.existsSync(CS_BINARY)) return;
  execSync(`go build -o "${CS_BINARY}" ./cmd/cs-workflow`, {
    cwd: SERVER_DIR,
    env: { ...process.env, GOOS: "linux", CGO_ENABLED: "0" },
    stdio: "ignore",
  });
}

export function cleanupCsWorkflowArtifacts() {
  try { fs.rmSync(DOC_FILE, { force: true }); } catch { /* ignore */ }
}

/** Run `cs-workflow gitea submit` in a container on multica_default (reaches
 *  gitea:3000 + backend:8080 by DNS). Returns the PR URL the CLI prints. */
export function runCsWorkflowSubmit(opts: {
  token: string;
  workspaceId: string;
  nodeRunId: string;
  deliverableId: string;
  owner: string;
  repo: string;
  instBranch: string;
  nodeBranch: string;
  deliverablesJson: string;
}): string {
  const dockerArgs = [
    "docker", "run", "--rm", "--network", "multica_default",
    "-v", `${CS_BINARY}:/usr/local/bin/cs-workflow`,
    "-v", `${SERVER_DIR}:/work`,
    "-v", `${DOC_FILE}:/work/cs-e2e-doc.md`,
  ];
  if (GO_MOD_CACHE) dockerArgs.push("-v", `${GO_MOD_CACHE}:/go/pkg/mod`);
  dockerArgs.push(
    "-e", `MULTICA_TOKEN=${opts.token}`,
    "-e", "MULTICA_SERVER_URL=http://backend:8080",
    "-e", `MULTICA_WORKSPACE_ID=${opts.workspaceId}`,
    "-e", `MULTICA_NODE_RUN_ID=${opts.nodeRunId}`,
    "-e", `MULTICA_GITEA_OWNER=${opts.owner}`,
    "-e", `MULTICA_GITEA_REPO=${opts.repo}`,
    "-e", `MULTICA_GITEA_CLONE_URL=http://gitea:3000/${opts.owner}/${opts.repo}.git`,
    "-e", `MULTICA_GITEA_INST_BRANCH=${opts.instBranch}`,
    "-e", `MULTICA_GITEA_NODE_BRANCH=${opts.nodeBranch}`,
    "-e", `MULTICA_GITEA_DELIVERABLES=${opts.deliverablesJson}`,
    "alpine:3.20",
    "sh", "-c",
    "apk add --no-cache git >/dev/null 2>&1 && cs-workflow gitea submit --deliverable " +
      `${opts.deliverableId} --file /work/cs-e2e-doc.md`,
  );
  // execFileSync (not execSync+join) so Windows doesn't run the args through a
  // shell - the long -v paths and the sh -c "apk ... && cs-workflow ..." command
  // break cmd.exe parsing ("system cannot find the path").
  const out = execFileSync("docker", dockerArgs.slice(1), {
    encoding: "utf-8",
    env: { ...process.env },
    timeout: 180000,
  });
  const lines = out.trim().split("\n");
  return lines[lines.length - 1].trim();
}

/** Pull request index from a Gitea PR web URL (.../pulls/<n>). */
export function prIndexFromUrl(url: string): number {
  const m = url.match(/\/pulls\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
