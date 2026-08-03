import { type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const DEFAULT_E2E_NAME = "E2E User";
const DEFAULT_E2E_EMAIL = "e2e@multica.ai";
const DEFAULT_E2E_WORKSPACE = "e2e-workspace";

function workspacePath(slug: string, suffix = "/issues") {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
  return `${basePath}/${slug}${suffix}`;
}

function browserOrigin() {
  return new URL(
    process.env.PLAYWRIGHT_BASE_URL ??
      process.env.FRONTEND_ORIGIN ??
      "http://localhost:3000",
  ).origin;
}

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Authenticates via API (send-code → DB read → verify-code), then sets the
 * multica_auth cookie so the browser session is authenticated.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  const workspace = await api.ensureWorkspace(
    "E2E Workspace",
    DEFAULT_E2E_WORKSPACE,
  );

  const token = api.getToken();
  const csrfToken = api.getCsrfToken();

  // Cookie auth mode: set the multica_auth HttpOnly cookie via Playwright's
  // browser context API. The web app uses cookie-based auth — localStorage
  // tokens are only for the legacy desktop bridge and won't work in a browser.
  await page.context().addCookies([
    {
      name: "multica_auth",
      value: token!,
      url: browserOrigin(),
      httpOnly: true,
      sameSite: "Lax",
    },
    ...(csrfToken
      ? [
          {
            name: "multica_csrf",
            value: csrfToken,
            url: browserOrigin(),
            httpOnly: false,
            sameSite: "Lax" as const,
          },
        ]
      : []),
  ]);

  await page.goto(workspacePath(workspace.slug));
  await page.waitForURL(`**/${workspace.slug}/issues`, { timeout: 10000 });
  return workspace.slug;
}

/**
 * Authenticate the browser with a pre-existing JWT token and navigate to the
 * workspace issues page.  Use this when you already have a valid JWT (e.g.
 * from a real user session) and want to skip the email-verification flow.
 *
 * Sets the multica_auth HttpOnly cookie via Playwright's browser context
 * cookie API, which mimics what the backend does on successful login. The web
 * app uses cookie-based auth — localStorage tokens are only for legacy desktop
 * bridge mode and will not work in a browser.
 */
export async function loginWithToken(
  page: Page,
  token: string,
  workspaceSlug: string,
  csrfToken?: string | null,
): Promise<void> {
  // Cookie auth mode: the web app checks hasLegacyToken() at mount. If
  // multica_token is absent from localStorage, it falls into cookie-auth mode
  // where getMe() sends the multica_auth cookie automatically.
  await page.context().addCookies([
    {
      name: "multica_auth",
      value: token,
      url: browserOrigin(),
      httpOnly: true,
      sameSite: "Lax",
    },
    ...(csrfToken
      ? [
          {
            name: "multica_csrf",
            value: csrfToken,
            url: browserOrigin(),
            httpOnly: false,
            sameSite: "Lax" as const,
          },
        ]
      : []),
  ]);

  await page.goto(workspacePath(workspaceSlug));
  await page.waitForURL(`**/${workspaceSlug}/issues`, { timeout: 10000 });
}

/**
 * Create a TestApiClient using an existing JWT token.  No login flow —
 * the token is injected directly so the client can make authenticated API
 * calls for setting up / tearing down test data.
 */
export function createApiWithToken(token: string, workspaceId: string, workspaceSlug: string): TestApiClient {
  const api = new TestApiClient();
  api.injectToken(token);
  api.setWorkspaceId(workspaceId);
  api.setWorkspaceSlug(workspaceSlug);
  return api;
}

/**
 * Create a TestApiClient logged in as the default E2E user.
 * Call api.cleanup() in afterEach to remove test data created during the test.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const api = new TestApiClient();
  await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
  await api.ensureWorkspace("E2E Workspace", DEFAULT_E2E_WORKSPACE);
  return api;
}

export async function openWorkspaceMenu(page: Page) {
  // Click the workspace switcher button (has ChevronDown icon)
  await page.locator("aside button").first().click();
  // Wait for dropdown to appear
  await page.locator('[class*="popover"]').waitFor({ state: "visible" });
}
