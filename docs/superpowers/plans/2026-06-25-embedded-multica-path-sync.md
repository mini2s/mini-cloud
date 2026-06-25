# 嵌入式 multica 路径双向同步 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让云平台(app-ai-native)嵌入的 multica iframe 与父端 URL 双向同步路径 —— 地址栏反映当前 multica 页面、刷新/分享/深链都能用 —— 且不整页重载。

**Architecture:** 跨两仓库。子端(multica)通过 `postMessage` 上报当前 pathname 并接受跳转指令;父端(app-ai-native)用通配符路由 `/workflow/*rest` 接住子路径,拼进 iframe `src`(仅挂载时一次),并据上报更新地址栏、据地址栏变化驱动 iframe。防死循环靠单一状态 `lastChildPath` + "路径没变就不动"。

**Tech Stack:** multica — Next.js 16 App Router + React + vitest(jsdom)。app-ai-native — SolidJS + `@solidjs/router` 0.15.4 + Bun test(happy-dom)。

**Spec:** `docs/superpowers/specs/2026-06-25-embedded-multica-path-sync-design.md`

**仓库与工作目录(每个任务都标注):**
- multica 仓库:`e:\Projects\multica`(当前分支 `feat/verify-and-tweak`)
- app-ai-native(opencode 仓库内):`e:\Projects\opencode\packages\app-ai-native`(执行前 `git status` 确认分支)

---

## 文件结构

**multica 仓库:**
- `packages/core/platform/costrict-bridge.ts` — 加 `postLocationToParent` / `parseParentRouteCommand`(纯逻辑,可单测)。
- `packages/core/platform/costrict-bridge.test.ts` — 补上面两个 helper 的测试。
- `apps/web/components/costrict-embed-sync.tsx` — **新建**客户端组件,用 `usePathname`/`useRouter` 把桥接 helper 接到 Next 路由上。
- `apps/web/components/costrict-embed-sync.test.tsx` — **新建**组件测试。
- `apps/web/app/layout.tsx` — 挂载同步组件(1 处 import + 1 处 JSX)。

**app-ai-native 仓库:**
- `src/pages/multica/sync-action.ts` — **新建**纯判定函数(防循环核心,可单测)。
- `src/pages/multica/sync-action.test.ts` — **新建** Bun 测试。
- `src/routes.tsx` — `/workflow` → `/workflow/*rest`。
- `src/pages/multica/multica-page.tsx` — iframe `src` 拼子路径(挂载时一次)+ 收 `multica:location` 更新地址栏 + splat 变化发 `multica:route` + 接 sync-action。

---

## Task 1: multica 子端桥接 helper(costrict-bridge.ts)

**仓库:** multica · **工作目录:** `e:\Projects\multica`
**Files:**
- Modify: `packages/core/platform/costrict-bridge.ts`(在 `postCostrictNavigateToSession` 之后追加)
- Test: `packages/core/platform/costrict-bridge.test.ts`

- [ ] **Step 1: 在 `costrict-bridge.test.ts` 顶部补 import,并追加两个 describe**

把现有 import 改为:
```ts
import {
  isEmbeddedInCostrict,
  parseParentRouteCommand,
  postCostrictNavigateToSession,
  postLocationToParent,
} from "./costrict-bridge";
```

在文件末尾(`describe("postCostrictNavigateToSession", …)` 之后)追加:
```ts
  describe("postLocationToParent", () => {
    it("posts the location message to the parent when embedded", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      postLocationToParent("/ipd-1/issues/abc");

      expect(postMessage).toHaveBeenCalledWith(
        { type: "multica:location", path: "/ipd-1/issues/abc" },
        "*",
      );
    });

    it("no-ops when path is empty", () => {
      const postMessage = vi.fn();
      const parent = { postMessage } as unknown as Window;
      vi.stubGlobal("window", { parent } as unknown as Window);

      postLocationToParent("");

      expect(postMessage).not.toHaveBeenCalled();
    });

    it("no-ops when there is no parent frame (standalone)", () => {
      const postMessage = vi.fn();
      const w = {} as Record<string, unknown>;
      w.parent = w;
      w.postMessage = postMessage;
      vi.stubGlobal("window", w as unknown as Window);

      postLocationToParent("/inbox");

      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe("parseParentRouteCommand", () => {
    const parent = { postMessage: vi.fn() } as unknown as Window;

    it("returns the path for a valid command from the parent", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: parent,
        data: { type: "multica:route", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toEqual({ path: "/inbox" });
    });

    it("returns null when source is not the parent", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: {} as Window,
        data: { type: "multica:route", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toBeNull();
    });

    it("returns null for a different message type", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      const event = {
        source: parent,
        data: { type: "multica:location", path: "/inbox" },
      } as MessageEvent;

      expect(parseParentRouteCommand(event)).toBeNull();
    });

    it("returns null when path is missing or empty", () => {
      vi.stubGlobal("window", { parent } as unknown as Window);
      expect(
        parseParentRouteCommand({
          source: parent,
          data: { type: "multica:route" },
        } as MessageEvent),
      ).toBeNull();
      expect(
        parseParentRouteCommand({
          source: parent,
          data: { type: "multica:route", path: "" },
        } as MessageEvent),
      ).toBeNull();
    });
  });
```

- [ ] **Step 2: 跑测试,确认新增用例失败(函数尚未实现)**

Run (from `e:\Projects\multica`):
```bash
pnpm --filter @multica/core exec vitest run platform/costrict-bridge.test.ts
```
Expected: FAIL —— `postLocationToParent` / `parseParentRouteCommand` 未导出(导入报错或 undefined)。

- [ ] **Step 3: 在 `costrict-bridge.ts` 末尾(`postCostrictNavigateToSession` 之后)追加实现**

```ts
/** Message multica posts to report its current route to the costrict-web parent. */
export interface CostrictLocationMessage {
  type: "multica:location";
  /** multica pathname, e.g. "/ipd-1/issues/<uuid>". Always begins with "/". */
  path: string;
}

/**
 * Report multica's current pathname to the costrict-web parent so the parent
 * can mirror it in its own URL (shareable, reload-stable). No-op when not
 * embedded, when there is no parent frame, or when `path` is empty. Call on
 * mount and on every multica route change while embedded.
 */
export function postLocationToParent(path: string): void {
  if (typeof window === "undefined") return;
  if (!path) return;
  if (window.parent === window) return;
  const message: CostrictLocationMessage = {
    type: "multica:location",
    path,
  };
  // Target origin "*" mirrors the existing parent contract; the parent
  // validates event.origin on its side.
  window.parent.postMessage(message, "*");
}

/** Message the costrict-web parent posts to drive embedded multica navigation. */
export interface ParentRouteCommandMessage {
  type: "multica:route";
  path: string;
}

/**
 * Parse an inbound `multica:route` command from the costrict-web parent.
 * Returns the target pathname when the message comes from the parent frame and
 * has the expected shape with a non-empty string `path`; otherwise `null`. The
 * command only navigates within multica, so the bar is `source === parent`
 * plus shape — tighten with an origin allow-list later if needed.
 */
export function parseParentRouteCommand(
  event: MessageEvent,
): { path: string } | null {
  if (event.source !== window.parent) return null;
  if (typeof event.data !== "object" || event.data === null) return null;
  if (event.data.type !== "multica:route") return null;
  if (typeof event.data.path !== "string" || event.data.path === "") return null;
  return { path: event.data.path };
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run (from `e:\Projects\multica`):
```bash
pnpm --filter @multica/core exec vitest run platform/costrict-bridge.test.ts
```
Expected: PASS(全部用例,含原有)。

- [ ] **Step 5: 类型检查 + 提交**

Run:
```bash
pnpm --filter @multica/core typecheck
```
Expected: 无错误。

```bash
cd e:\Projects\multica
git add packages/core/platform/costrict-bridge.ts packages/core/platform/costrict-bridge.test.ts
git commit -m "feat(core): report embedded location and accept parent route command"
```

---

## Task 2: multica web 嵌入同步组件

**仓库:** multica · **工作目录:** `e:\Projects\multica`
**Files:**
- Create: `apps/web/components/costrict-embed-sync.tsx`
- Test: `apps/web/components/costrict-embed-sync.test.tsx`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 1: 写组件测试 `apps/web/components/costrict-embed-sync.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mutable test state so individual cases can flip embedded/pathname.
const embeddedState = { value: true };
const postedPaths: string[] = [];
const routerPush = vi.fn();
let currentPathname = "/inbox";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@multica/core/platform/costrict-bridge", () => ({
  isEmbeddedInCostrict: () => embeddedState.value,
  postLocationToParent: (path: string) => {
    postedPaths.push(path);
  },
  parseParentRouteCommand: (event: MessageEvent) =>
    event.data?.type === "multica:route" && typeof event.data?.path === "string"
      ? { path: event.data.path }
      : null,
}));

import { CostrictEmbedSync } from "./costrict-embed-sync";

describe("CostrictEmbedSync", () => {
  beforeEach(() => {
    postedPaths.length = 0;
    routerPush.mockClear();
    embeddedState.value = true;
    currentPathname = "/inbox";
  });

  it("reports the current pathname to the parent when embedded", () => {
    render(<CostrictEmbedSync />);
    expect(postedPaths).toEqual(["/inbox"]);
  });

  it("does nothing when not embedded", () => {
    embeddedState.value = false;
    render(<CostrictEmbedSync />);
    expect(postedPaths).toEqual([]);
  });

  it("navigates on an inbound multica:route command from the parent", () => {
    render(<CostrictEmbedSync />);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { type: "multica:route", path: "/settings" },
      }),
    );
    expect(routerPush).toHaveBeenCalledWith("/settings");
  });

  it("ignores a route command equal to the current pathname", () => {
    render(<CostrictEmbedSync />);
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window.parent,
        data: { type: "multica:route", path: "/inbox" },
      }),
    );
    expect(routerPush).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试,确认失败(组件不存在)**

Run (from `e:\Projects\multica`):
```bash
pnpm --filter @multica/web exec vitest run components/costrict-embed-sync.test.tsx
```
Expected: FAIL —— 无法解析 `./costrict-embed-sync`。

- [ ] **Step 3: 创建组件 `apps/web/components/costrict-embed-sync.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isEmbeddedInCostrict,
  parseParentRouteCommand,
  postLocationToParent,
} from "@multica/core/platform/costrict-bridge";

/**
 * When multica runs embedded inside the costrict-web platform, keep the parent's
 * URL in sync with the page the user is on:
 *  - report the current pathname to the parent on mount and on every route
 *    change (the parent mirrors it in its own URL);
 *  - honour inbound `multica:route` commands from the parent (browser
 *    back/forward/manual URL edits) by navigating here without a full reload.
 * No-op when standalone. Mounted once from the root layout.
 */
export function CostrictEmbedSync() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isEmbeddedInCostrict()) return;
    if (pathname) postLocationToParent(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!isEmbeddedInCostrict()) return;
    const onMessage = (event: MessageEvent) => {
      const cmd = parseParentRouteCommand(event);
      if (cmd && cmd.path !== pathname) router.push(cmd.path);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, pathname]);

  return null;
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run (from `e:\Projects\multica`):
```bash
pnpm --filter @multica/web exec vitest run components/costrict-embed-sync.test.tsx
```
Expected: PASS(4 个用例)。

- [ ] **Step 5: 在根布局挂载组件 —— 改 `apps/web/app/layout.tsx`**

在 import 区(`import { WebProviders } from "@/components/web-providers";` 附近)加一行:
```ts
import { CostrictEmbedSync } from "@/components/costrict-embed-sync";
```

把 `<body>` 内 `<Toaster />` 后面加一行(放在 `</ThemeProvider>` 之前):
```tsx
          <WebProviders locale={locale} resources={resources}>
            {children}
          </WebProviders>
          <Toaster />
          <CostrictEmbedSync />
```

- [ ] **Step 6: 类型检查 + 提交**

Run (from `e:\Projects\multica`):
```bash
pnpm --filter @multica/web typecheck
```
Expected: 无错误。

```bash
cd e:\Projects\multica
git add apps/web/components/costrict-embed-sync.tsx apps/web/components/costrict-embed-sync.test.tsx apps/web/app/layout.tsx
git commit -m "feat(web): sync embedded multica location with parent platform"
```

---

## Task 3: app-ai-native 纯判定函数(sync-action.ts)

**仓库:** app-ai-native(opencode)· **工作目录:** `e:\Projects\opencode\packages\app-ai-native`
**Files:**
- Create: `src/pages/multica/sync-action.ts`
- Test: `src/pages/multica/sync-action.test.ts`

- [ ] **Step 1: 写测试 `src/pages/multica/sync-action.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import { decideSyncAction, pathToSplat, splatToPath } from "./sync-action";

describe("splatToPath / pathToSplat", () => {
  test("empty splat is home", () => {
    expect(splatToPath("")).toBe("/");
    expect(splatToPath("/")).toBe("/");
  });
  test("splat with segments becomes a leading-slash path", () => {
    expect(splatToPath("ipd-1/issues/abc")).toBe("/ipd-1/issues/abc");
  });
  test("path round-trips through splat", () => {
    expect(pathToSplat("/ipd-1/issues/abc")).toBe("ipd-1/issues/abc");
    expect(pathToSplat("/")).toBe("");
  });
});

describe("decideSyncAction — child location (child → parent)", () => {
  test("updates URL and records the child path", () => {
    const action = decideSyncAction(
      { currentSplat: "", lastChildPath: "/" },
      { kind: "childLocation", path: "/ipd-1/issues/abc" },
    );
    expect(action).toEqual({
      updateUrl: "/workflow/ipd-1/issues/abc",
      lastChildPath: "/ipd-1/issues/abc",
    });
  });

  test("home path maps to bare /workflow", () => {
    const action = decideSyncAction(
      { currentSplat: "ipd-1/issues/abc", lastChildPath: "/ipd-1/issues/abc" },
      { kind: "childLocation", path: "/" },
    );
    expect(action).toEqual({ updateUrl: "/workflow", lastChildPath: "/" });
  });
});

describe("decideSyncAction — splat change (parent → child)", () => {
  test("posts a route command when splat differs from child's location", () => {
    const action = decideSyncAction(
      { currentSplat: "", lastChildPath: "/" },
      { kind: "splatChange", splat: "ipd-1/issues/abc" },
    );
    expect(action).toEqual({
      postRoute: "/ipd-1/issues/abc",
      lastChildPath: "/ipd-1/issues/abc",
    });
  });

  test("no-op when splat matches where the child already is (breaks the loop)", () => {
    const action = decideSyncAction(
      { currentSplat: "ipd-1/issues/abc", lastChildPath: "/ipd-1/issues/abc" },
      { kind: "splatChange", splat: "ipd-1/issues/abc" },
    );
    expect(action).toEqual({});
  });

  test("empty splat posts home", () => {
    const action = decideSyncAction(
      { currentSplat: "ipd-1/issues/abc", lastChildPath: "/ipd-1/issues/abc" },
      { kind: "splatChange", splat: "" },
    );
    expect(action).toEqual({ postRoute: "/", lastChildPath: "/" });
  });
});
```

- [ ] **Step 2: 跑测试,确认失败**

Run (from `e:\Projects\opencode\packages\app-ai-native`):
```bash
bun test src/pages/multica/sync-action.test.ts
```
Expected: FAIL —— 找不到 `./sync-action`。

- [ ] **Step 3: 创建 `src/pages/multica/sync-action.ts`**

```ts
/**
 * Pure decision logic for the two-way path sync between the app-ai-native URL
 * (`/workflow/<multica-path>`) and the embedded multica iframe. Given the
 * current state and an event, returns the side effects to perform; the
 * component performs them. Kept pure + stateless so the loop-avoidance logic is
 * unit-testable without a router or iframe.
 */

export interface SyncState {
  /** Current `rest` splat from `/workflow/*rest` (no leading slash). */
  currentSplat: string;
  /** The multica path the child most recently reported / is heading to (leading slash). */
  lastChildPath: string;
}

/** URL splat ("ipd-1/issues/x") → multica path ("/ipd-1/issues/x"); "" → "/". */
export function splatToPath(splat: string): string {
  const trimmed = splat.replace(/^\/+/, "");
  return trimmed === "" ? "/" : `/${trimmed}`;
}

/** multica path ("/ipd-1/issues/x") → URL splat ("ipd-1/issues/x"); "/" → "". */
export function pathToSplat(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export type SyncEvent =
  | { kind: "childLocation"; path: string }
  | { kind: "splatChange"; splat: string };

export interface SyncAction {
  /** URL to navigate to with `replace: true` (the `/workflow` + path form). */
  updateUrl?: string;
  /** multica path to post as `{ type: "multica:route" }` to the iframe. */
  postRoute?: string;
  /** New value for `lastChildPath`. */
  lastChildPath?: string;
}

/**
 * Decide the next action for a sync event. Loop avoidance rests on
 * `lastChildPath`: the parent updates the URL on a child location report; the
 * splat change that triggers is a no-op because the new splat already equals
 * `lastChildPath`. A splat change matching the child's current location is a
 * no-op. Everything else is "skip when unchanged" at the call sites.
 */
export function decideSyncAction(state: SyncState, event: SyncEvent): SyncAction {
  if (event.kind === "childLocation") {
    return {
      updateUrl: `/workflow${event.path === "/" ? "" : event.path}`,
      lastChildPath: event.path,
    };
  }
  const path = splatToPath(event.splat);
  if (path === state.lastChildPath) return {};
  return { postRoute: path, lastChildPath: path };
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run (from `e:\Projects\opencode\packages\app-ai-native`):
```bash
bun test src/pages/multica/sync-action.test.ts
```
Expected: PASS(全部用例)。

- [ ] **Step 5: 类型检查 + 提交**

Run (from `e:\Projects\opencode\packages\app-ai-native`):
```bash
bun run typecheck
```
Expected: 无错误。

```bash
cd e:\Projects\opencode\packages\app-ai-native
git add src/pages/multica/sync-action.ts src/pages/multica/sync-action.test.ts
git commit -m "feat(multica): pure decision logic for embedded path sync"
```

---

## Task 4: app-ai-native 路由通配符(/workflow/*rest)

**仓库:** app-ai-native(opencode)· **工作目录:** `e:\Projects\opencode\packages\app-ai-native`
**Files:**
- Modify: `src/routes.tsx`(以及一并提交已完成的 `src/pages/root-layout.tsx` 路由改名)

> 说明:`/multica` → `/workflow` 的改名(routes.tsx + root-layout.tsx)在本任务开始前应已存在于工作区(未提交)。本任务把它扩展为通配符,并把"改名 + 通配符"作为一次提交。

- [ ] **Step 1: 改 `src/routes.tsx` 的 `/workflow` 路由为通配符**

把:
```ts
  {
    path: "/workflow",
    component: MulticaPage,
    auth: true,
  },
```
改为:
```ts
  {
    // Trailing multica path is captured into `rest` (e.g. "/workflow/ipd-1/issues/x"
    // → rest="ipd-1/issues/x"). The bare "/workflow" also matches, with rest="".
    // Verified against @solidjs/router 0.15.4 matcher: matchSegment("", undefined)
    // returns true, so "/workflow/*rest" matches "/workflow".
    path: "/workflow/*rest",
    component: MulticaPage,
    auth: true,
  },
```

- [ ] **Step 2: 确认 `root-layout.tsx` 的 `/multica` → `/workflow` 改名已就位**

Run:
```bash
cd e:\Projects\opencode\packages\app-ai-native
git diff -- src/pages/root-layout.tsx
```
Expected: 看到 `path === "/multica"` → `path === "/workflow"` 与 `navigate("/multica")` → `navigate("/workflow")` 两处改动。若无,补上(参考该文件 142、170 行附近)。

- [ ] **Step 3: 类型检查 + 提交(改名 + 通配符一起)**

Run (from `e:\Projects\opencode\packages\app-ai-native`):
```bash
bun run typecheck
```
Expected: 无错误。

```bash
cd e:\Projects\opencode\packages\app-ai-native
git add src/routes.tsx src/pages/root-layout.tsx
git commit -m "feat(routes): rename /multica to /workflow and capture multica sub-path"
```

---

## Task 5: app-ai-native 父端页面接入同步(multica-page.tsx)

**仓库:** app-ai-native(opencode)· **工作目录:** `e:\Projects\opencode\packages\app-ai-native`
**Files:**
- Modify: `src/pages/multica/multica-page.tsx`

- [ ] **Step 1: 把 `src/pages/multica/multica-page.tsx` 整体替换为下面版本**

要点:① 用 `useParams` 读 `rest`;② iframe `src` 仅在挂载时按初始 splat 拼一次,之后冻结;③ `handleMessage` 增补 `multica:location` 分支;④ 新增 `createEffect` 在 splat 外部变化时发 `multica:route`;⑤ 复用 `decideSyncAction` 做防循环判定。

```tsx
import { createSignal, createEffect, onMount, onCleanup } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useAuth } from "@/context/auth"
import { useLanguage } from "@/context/language"
import { workspaceApi, deviceApi } from "@/pages/workspace/lib/api"
import { getProxyUrl } from "@/pages/workspace/lib/url"
import { createDeviceClient } from "@/client/device-client"
import { openSessionById } from "./open-session-by-id"
import { decideSyncAction } from "./sync-action"

function getMulticaUrl(): string {
  // Runtime-configurable via env; falls back to a sensible default.
  return import.meta.env.VITE_MULTICA_WEB_URL || "https://zgsmtest.cn:30443/workflow-web"
}

export default function MulticaPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const params = useParams<{ rest?: string }>()
  const t = useLanguage().t
  const [isLoading, setIsLoading] = createSignal(true)
  const [hasError, setHasError] = createSignal(false)

  const url = getMulticaUrl()

  // The multica sub-path captured at mount. Never updated after mount — later
  // navigations go through postMessage, not src rewriting (which would reload
  // the iframe). A hard reload of the parent remounts this component, so the
  // splat is re-read and the iframe re-opens at the right path.
  const rest = () => params.rest ?? ""
  const initialSubPath = rest() === "" ? "" : `/${rest()}`
  const lastChildPath = { current: initialSubPath === "" ? "/" : initialSubPath }

  // Build the iframe URL with an auth hint so multica-web can recognise it is
  // running inside an iframe, plus the initial multica sub-path for deep links.
  const baseIframe = new URL(url)
  baseIframe.pathname = baseIframe.pathname.replace(/\/+$/, "") + initialSubPath
  baseIframe.searchParams.set("embedded", "opencode")
  const email = auth.user()?.email
  if (email) baseIframe.searchParams.set("preferred_email", email)
  const iframeSrc = baseIframe.toString()

  let iframeRef: HTMLIFrameElement | undefined

  const handleLoad = () => {
    setIsLoading(false)
  }

  const handleError = () => {
    setIsLoading(false)
    setHasError(true)
  }

  // Open a csc session by id. multica reports only the session id; the session
  // lives in an isolated working dir that belongs to no workspace, so we probe
  // the user's devices to find which one has it, then reuse or create a
  // workspace on that device and deep-link into the session viewer.
  const openSession = (sessionId: string) =>
    openSessionById(sessionId, {
      listDevices: async () => (await deviceApi.list()).devices,
      probeSession: async (device, sid) => {
        const client = createDeviceClient({ baseUrl: getProxyUrl(device.deviceId) })
        const session = (await client.conversation.get(sid)) as Session | undefined
        return session && session.id === sid ? { directory: session.directory } : null
      },
      listWorkspaces: async () => (await workspaceApi.list()).workspaces,
      createWorkspace: async ({ name, deviceId, directory }) => {
        const res = await workspaceApi.create({
          name,
          deviceId,
          directories: [{ name: "default", path: directory, isDefault: true }],
        })
        return res.workspace.id
      },
      navigateToSession: (workspaceId, sid) =>
        navigate(`/workspace/${workspaceId}?session=${encodeURIComponent(sid)}`),
      onError: (reason) =>
        showToast({
          variant: "error",
          title: t("toast.multica.openSession.title"),
          description: t(
            reason === "not_found"
              ? "toast.multica.openSession.notFound"
              : "toast.multica.openSession.failed",
          ),
        }),
    })

  // Post-message bridge: listen for navigation/location requests from the
  // embedded app so we can mirror its path in our URL and deep-link back.
  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== new URL(url).origin) return
    if (typeof event.data !== "object" || event.data === null) return

    if (event.data.type === "multica:navigate") {
      // Open a csc session by id.
      if (event.data.target === "session" && typeof event.data.sessionId === "string") {
        void openSession(event.data.sessionId)
        return
      }
      // Legacy: bare href navigation requests (currently logged only).
      if (typeof event.data.href === "string") {
        console.log("[Multica_embed] navigate request:", event.data.href)
      }
      return
    }

    if (event.data.type === "multica:location" && typeof event.data.path === "string") {
      const action = decideSyncAction(
        { currentSplat: rest(), lastChildPath: lastChildPath.current },
        { kind: "childLocation", path: event.data.path },
      )
      if (action.lastChildPath !== undefined) lastChildPath.current = action.lastChildPath
      if (action.updateUrl) navigate(action.updateUrl, { replace: true })
      return
    }

    if (event.data.type === "multica:ready") {
      setIsLoading(false)
    }
  }

  // When the splat changes externally (browser back/forward, manual edit, or an
  // in-app link), ask the embedded multica to navigate. No-op on mount and
  // whenever the splat already matches where the child is (loop guard).
  createEffect(() => {
    const splat = rest()
    const action = decideSyncAction(
      { currentSplat: splat, lastChildPath: lastChildPath.current },
      { kind: "splatChange", splat },
    )
    if (action.lastChildPath !== undefined) lastChildPath.current = action.lastChildPath
    if (action.postRoute) {
      iframeRef?.contentWindow?.postMessage(
        { type: "multica:route", path: action.postRoute },
        "*",
      )
    }
  })

  onMount(() => {
    window.addEventListener("message", handleMessage)
  })

  onCleanup(() => {
    window.removeEventListener("message", handleMessage)
  })

  return (
    <div class="relative flex h-full w-full flex-col overflow-hidden bg-[var(--native-bg)]">
      {/* Loading overlay */}
      {isLoading() && (
        <div class="absolute inset-0 z-10 flex items-center justify-center bg-[var(--native-bg)]">
          <div class="flex flex-col items-center gap-3">
            <div class="size-6 animate-spin rounded-full border-2 border-[var(--native-primary)] border-t-transparent" />
            <span class="text-xs text-[var(--native-dim)]">Loading Multica...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {hasError() && (
        <div class="absolute inset-0 z-10 flex items-center justify-center bg-[var(--native-bg)]">
          <div class="flex flex-col items-center gap-3 rounded-lg border border-[var(--native-border)] bg-[var(--native-panel)] p-6">
            <span class="text-sm text-[var(--native-foreground)]">Unable to load Multica</span>
            <span class="text-xs text-[var(--native-dim)]">{url}</span>
            <button
              type="button"
              onClick={() => {
                setHasError(false)
                setIsLoading(true)
                iframeRef?.contentWindow?.location.reload()
              }}
              class="mt-2 rounded-md bg-[var(--native-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        title="Multica"
        class="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        allow="clipboard-read; clipboard-write"
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
}
```

- [ ] **Step 2: 类型检查 + 单测回归**

Run (from `e:\Projects\opencode\packages\app-ai-native`):
```bash
bun run typecheck
bun test src/pages/multica
```
Expected: typecheck 无错误;`src/pages/multica` 下测试(sync-action + 既有 open-session-by-id)全过。

- [ ] **Step 3: 提交**

```bash
cd e:\Projects\opencode\packages\app-ai-native
git add src/pages/multica/multica-page.tsx
git commit -m "feat(multica): two-way path sync between URL and embedded iframe"
```

---

## Task 6: 手动 / E2E 验证(两端联调)

> 单测只覆盖纯逻辑;iframe 与父端 URL 的真实双向同步必须手动跑通(需要 multica web + app-ai-native 同时运行)。`usePathname()` 在 Next 16 默认不含 basePath(spec 的 base-path 对齐假设),此处一并核实。

**前置:** multica web(`make dev` 或 `pnpm dev:web`,端口 3000)+ app-ai-native(`pnpm dev`,指向 multica 的 `VITE_MULTICA_WEB_URL`)同时运行。

- [ ] **Step 1: 子→父同步**
  - 在 app-ai-native 打开 `/cloud/workflow`,在 iframe 里点进某个 issue。
  - 预期:父端地址栏变成 `/cloud/workflow/<slug>/issues/<id>`。
  - 再点收件箱/设置等,地址栏持续跟随。
  - **base-path 核实:** 父端地址里 `<slug>/issues/<id>` 是否与独立 multica(`http://127.0.0.1:3000/<slug>/issues/<id>`)一致。若多了 basePath 前缀,说明 `usePathname()` 含 basePath —— 在 `costrict-embed-sync.tsx` 的上报前剥离 basePath:
    ```ts
    // 仅当 Step 1 核实发现 pathname 含 basePath 时才加:
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const path = basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
    ```
    (multica 目前无 basePath,通常不需要这段。)

- [ ] **Step 2: 刷新保留**
  - 停在某个 issue 的 `/cloud/workflow/<slug>/issues/<id>`,按 F5。
  - 预期:刷新后 iframe 仍打开该 issue(不是首页)。

- [ ] **Step 3: 分享/深链**
  - 复制该地址,在新标签页粘贴打开。
  - 预期:直接进到该 issue。

- [ ] **Step 4: 后退/前进**
  - 在 iframe 里依次进 issue A → issue B,再按浏览器后退。
  - 预期:iframe 跟着回到 A,**且不整页重载**(无全屏 loading 闪烁),父端地址同步变 A。

- [ ] **Step 5: 回归既有功能**
  - 触发一次"在 CoStrict 中打开 session"(`multica:navigate { target: "session" }`)。
  - 预期:仍正常跳到 workspace session viewer,未受影响。
  - 独立 multica(不带 `?embedded=opencode`)打开,确认地址栏行为、控制台均无同步相关输出(子端组件空操作)。

- [ ] **Step 6: 全量检查**

  multica 端:
  ```bash
  cd e:\Projects\multica && make check
  ```
  app-ai-native 端:
  ```bash
  cd e:\Projects\opencode\packages\app-ai-native && bun run typecheck && bun test
  ```
  Expected: 全绿。

---

## Self-Review(写完后自查)

- **Spec 覆盖:** 双向同步(Task 1+2 子端上报/接收,Task 3+5 父端镜像/驱动)✓;路径式 URL(Task 4 通配符)✓;全页面同步(上报任意 pathname,无白名单)✓;方案 A postMessage + 路由内跳转(Task 5 `router.push`/`navigate` 不重载)✓;新增型消息(未动 `multica:navigate` session)✓;独立 multica 不受影响(`isEmbeddedInCostrict` 门控)✓;防循环(`lastChildPath` + 纯函数)✓;测试(core helper、web 组件、sync-action 纯函数)✓;base-path 假设(Task 6 Step 1 核实 + 兜底代码)✓。
- **占位符扫描:** 无 TBD/TODO;"适当处理"等均已给出具体代码。
- **类型一致性:** `postLocationToParent(path)`、`parseParentRouteCommand(event)`、`decideSyncAction(state,event)`、`splatToPath`/`pathToSplat`、`CostrictEmbedSync` 在各任务中签名一致;`rest` splat 名在路由(`/workflow/*rest`)、读取(`useParams<{rest?:string}>`)、sync-action 文档中一致;消息 type 字符串(`multica:location`/`multica:route`)在两端一致。
