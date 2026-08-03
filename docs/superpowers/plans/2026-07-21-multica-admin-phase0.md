# Multica Admin UI — Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `apps/admin` Next.js app inside the monorepo that reuses `@multica/{core, ui, views}` verbatim, ships a shadcn-admin-inspired sidebar/header layout with all 32 routes accessible (10 re-exporting real views, 22 showing Coming Soon), connects to the real backend with zero mock layer, and passes typecheck/lint/build.

**Architecture:** Next.js App Router app coexisting with `apps/web`. Root layout injects the existing `CoreProvider` + `ThemeProvider` chain. `[workspaceSlug]` layout reuses the existing `WorkspaceSlugProvider` + `DashboardGuard` pattern. Dashboard layout swaps the shared `AppSidebar` for a new `AdminSidebar` defined locally inside `apps/admin` — this keeps the existing web sidebar untouched while giving admin a 7-group/32-route nav structure. Each route file is 1–10 lines: re-exports a view from `@multica/views/*`, or renders `<ComingSoon/>` for unbuilt pages.

**Tech Stack:** Next.js 16 (App Router, webpack — same as apps/web), React 19, `@base-ui/react` via `@multica/ui`, Tailwind v4, TanStack Query, Zustand, lucide-react, dayjs/date-fns.

**Reference spec:** `docs/superpowers/specs/2026-07-21-multica-admin-ui-design.md`

---

## Pre-flight Checks

Before starting, verify the following are true. If any is false, stop and ask the user.

- [ ] Working directory is the monorepo root (`multica-zgsm/`).
- [ ] `pnpm-workspace.yaml` contains `apps/*` (it does at time of writing).
- [ ] `apps/web/` exists and runs (we mirror its config).
- [ ] Current git branch is `new-ui-demo` (the spec was committed there). If not, switch: `git checkout new-ui-demo`.

```bash
# Verify all four in one command:
test -f pnpm-workspace.yaml \
  && grep -q "apps/\*" pnpm-workspace.yaml \
  && test -d apps/web \
  && git rev-parse --abbrev-ref HEAD | grep -q "new-ui-demo" \
  && echo "OK - all pre-flight checks pass" \
  || echo "FAIL - stop and ask the user"
```

---

## File Structure

```
apps/admin/                                     # NEW — entire directory created by this plan
├── app/
│   ├── layout.tsx                              # Root layout: fonts, ThemeProvider, CoreProvider, Toaster
│   ├── providers.tsx                           # WebProviders clone (without CostrictEmbedSync)
│   ├── globals.css                             # Imports tailwind + @multica/ui tokens (no landing-light)
│   ├── page.tsx                                # / → redirect to last workspace or /login
│   ├── not-found.tsx                           # Simple 404
│   ├── (auth)/
│   │   ├── login/page.tsx                      # Re-export LoginPage from @multica/views/auth
│   │   ├── invite/[id]/page.tsx                # Re-export InvitePage
│   │   └── invitations/page.tsx                # Re-export InvitationsPage
│   ├── auth/callback/page.tsx                  # OAuth callback (clone from apps/web)
│   └── [workspaceSlug]/
│       ├── layout.tsx                          # Workspace resolver + WorkspaceSlugProvider
│       └── (dashboard)/
│           ├── layout.tsx                      # AdminDashboardLayout (AdminSidebar + SidebarInset)
│           ├── loading.tsx                     # Spinner
│           ├── page.tsx                        # Home (Coming Soon for now)
│           ├── sessions/page.tsx               # Coming Soon
│           ├── tasks/page.tsx                  # Re-export MyIssuesPage
│           ├── reviews/page.tsx                # Coming Soon
│           ├── projects/page.tsx               # Re-export ProjectsPage
│           ├── projects/backlog/page.tsx       # Coming Soon
│           ├── issues/page.tsx                 # Re-export IssuesPage
│           ├── issues/[id]/page.tsx            # Re-export IssueDetail
│           ├── design/page.tsx                 # Coming Soon
│           ├── review/page.tsx                 # Coming Soon
│           ├── projects/settings/page.tsx      # Coming Soon
│           ├── workflows/page.tsx              # Re-export WorkflowsPage
│           ├── workflows/[id]/page.tsx         # Re-export WorkflowDetailShell
│           ├── workflows/[id]/runs/page.tsx    # Re-export WorkflowRunsPage
│           ├── workflows/[id]/runs/[runId]/page.tsx  # Re-export WorkflowRunPage
│           ├── squads/page.tsx                 # Re-export SquadsPage
│           ├── squads/[id]/page.tsx            # Re-export SquadDetailPage
│           ├── dispatch/page.tsx               # Coming Soon
│           ├── wiki/page.tsx                   # Coming Soon
│           ├── skills/page.tsx                 # Re-export SkillsPage
│           ├── skills/[id]/page.tsx            # Re-export SkillDetailPage
│           ├── memory/page.tsx                 # Coming Soon
│           ├── metrics/efficiency/page.tsx     # Coming Soon
│           ├── metrics/quality/page.tsx        # Coming Soon
│           ├── metrics/cost/page.tsx           # Coming Soon
│           ├── metrics/coverage/page.tsx       # Coming Soon
│           ├── metrics/contribution/page.tsx   # Coming Soon
│           ├── admin/members/page.tsx          # Re-export MembersPage
│           ├── admin/members/[id]/page.tsx     # Re-export MemberDetailPage
│           ├── admin/permissions/page.tsx      # Coming Soon
│           ├── admin/devices/page.tsx          # Coming Soon
│           ├── admin/connectors/page.tsx       # Coming Soon
│           ├── admin/channels/page.tsx         # Coming Soon
│           ├── admin/quotas/page.tsx           # Coming Soon
│           ├── me/profile/page.tsx             # Re-export SettingsPage with tab=profile
│           ├── me/quota/page.tsx               # Coming Soon
│           ├── me/notifications/page.tsx       # Coming Soon
│           ├── me/devices/page.tsx             # Coming Soon
│           └── me/preferences/page.tsx         # Re-export SettingsPage with tab=preferences
├── components/
│   ├── layout/
│   │   ├── admin-sidebar.tsx                   # 7-group sidebar (Home + Workbench + Projects + Collab + Repository + Metrics + Admin + Me)
│   │   ├── coming-soon.tsx                     # Placeholder for unbuilt pages
│   │   ├── sidebar-config.ts                   # Nav item config (single source of truth)
│   │   └── theme-toggle.tsx                    # Theme switch (uses next-themes + @multica/ui dropdown)
│   └── theme-provider.tsx                      # next-themes provider (clone from apps/web)
├── platform/
│   └── navigation.tsx                          # WebNavigationProvider clone (Next adapter)
├── features/
│   └── auth/
│       └── auth-cookie.ts                      # setLoggedInCookie/clearLoggedInCookie (clone)
├── middleware.ts                               # Rewrite /api /auth /uploads /ws → REMOTE_API_URL
├── next.config.ts                              # Mirror apps/web (transpilePackages, webpack shims not needed)
├── tsconfig.json                               # Mirror apps/web
├── postcss.config.mjs                          # Mirror apps/web
├── eslint.config.mjs                           # Mirror apps/web
├── components.json                             # shadcn config (mirror apps/web)
├── package.json                                # @multica/admin — subset of apps/web deps
├── README.md                                   # "Multica Admin — Phase 0" explainer
└── .gitignore                                  # Next.js defaults
```

**File responsibility principles:**
- Each `page.tsx` is 1–10 lines — never contains business logic.
- `admin-sidebar.tsx` reads its nav schema from `sidebar-config.ts` (single source of truth).
- `coming-soon.tsx` is the **only** placeholder component; all unbuilt pages call it with a label.
- `middleware.ts` is a copy of the documented pattern — verbatim, no creative additions.

---

## Task 1: Create apps/admin package skeleton

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/.gitignore`

- [ ] **Step 1: Create `apps/admin/package.json`**

```json
{
  "name": "@multica/admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "sh -c 'next dev --webpack --port \"${FRONTEND_PORT:-3100}\"'",
    "build": "next build --webpack",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@base-ui/react": "^1.3.0",
    "@multica/core": "workspace:*",
    "@multica/ui": "workspace:*",
    "@multica/views": "workspace:*",
    "@tanstack/react-query": "^5.96.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "lucide-react": "catalog:",
    "next": "^16.2.5",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-dom": "catalog:",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tw-animate-css": "^1.4.0",
    "zustand": "catalog:"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create `apps/admin/.gitignore`**

```
# dependencies
/node_modules

# next.js
/.next/
/out/
next-env.d.ts

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: package is linked into the workspace; no errors. The workspace root will recognize `@multica/admin`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/package.json apps/admin/.gitignore pnpm-lock.yaml
git commit -m "feat(admin): scaffold @multica/admin package"
```

---

## Task 2: Mirror essential config files from apps/web

**Files:**
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.ts`
- Create: `apps/admin/postcss.config.mjs`
- Create: `apps/admin/eslint.config.mjs`
- Create: `apps/admin/components.json`

- [ ] **Step 1: Create `apps/admin/tsconfig.json`** (copy from `apps/web/tsconfig.json` verbatim)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] },
    "noEmit": true,
    "allowJs": true,
    "incremental": true
  },
  "include": [
    "next-env.d.ts",
    "src",
    "app",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Create `apps/admin/next.config.ts`**

```ts
import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load root .env so REMOTE_API_URL is available at build time
config({ path: resolve(__dirname, "../../.env") });

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Parse hostnames from CORS_ALLOWED_ORIGINS for dev-server HMR allowance.
const allowedDevOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",")
      .map((origin) => {
        try {
          return new URL(origin.trim()).host;
        } catch {
          return origin.trim();
        }
      })
      .filter(Boolean)
  : undefined;

const nextConfig: NextConfig = {
  ...(process.env.STANDALONE === "true" ? { output: "standalone" as const } : {}),
  // apps/admin ships with empty base path by default (standalone dev).
  // Override with NEXT_PUBLIC_BASE_PATH if mounted under a subpath.
  ...(basePath ? { basePath } : {}),
  transpilePackages: ["@multica/core", "@multica/ui", "@multica/views"],
  ...(allowedDevOrigins && allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 80, 85],
  },
};

export default nextConfig;
```

> Note: apps/web has a `webpack()` hook for langium shims. apps/admin doesn't import anything that pulls in langium, so omit that block. If typecheck later complains about a langium import, add the shim back.

- [ ] **Step 3: Create `apps/admin/postcss.config.mjs`**

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 4: Create `apps/admin/eslint.config.mjs`**

```js
// ESLint config for @multica/admin.
// Mirrors apps/web — uses the shared flat config from the monorepo root.
import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    ignores: [".next/**", "node_modules/**", "out/**"],
  },
];
```

> If the root `eslint.config.mjs` is a flat config array, this extends it. If apps/web has a different pattern (e.g., imports from `@multica/eslint-config`), copy apps/web/eslint.config.mjs verbatim instead.

- [ ] **Step 5: Create `apps/admin/components.json`** (shadcn registry config — needed if we later `shadcn add` components)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@multica/ui/lib/utils",
    "ui": "@multica/ui/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin): mirror apps/web config (tsconfig, next.config, postcss, eslint, components.json)"
```

---

## Task 3: Wire API proxy middleware

**Files:**
- Create: `apps/admin/middleware.ts`

The proxy rewrites `/api/*`, `/auth/*`, `/uploads/*`, and `/ws` to `REMOTE_API_URL` (default `http://localhost:8080`). apps/web has a `proxy.ts` but never wired it as `middleware.ts` (looks like an oversight or the proxy was moved). We do it properly here.

- [ ] **Step 1: Create `apps/admin/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";

// Routes proxied to the Go backend at REMOTE_API_URL (default localhost:8080).
// Keeping this list explicit (rather than catching /* ) avoids proxying Next's
// own /_next assets and page routes.
const proxyPrefixes = ["/api/", "/auth/", "/uploads/"];
const proxyExact = ["/ws"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const shouldProxy =
    proxyPrefixes.some((p) => pathname.startsWith(p)) ||
    proxyExact.includes(pathname);

  if (!shouldProxy) {
    return NextResponse.next();
  }

  // Read backend URL from runtime env (falls back to dev default).
  const remoteApiUrl = process.env.REMOTE_API_URL || "http://localhost:8080";
  const url = new URL(pathname + request.nextUrl.search, remoteApiUrl);
  return NextResponse.rewrite(url);
}

export const config = {
  // Match all paths except Next internals; the function above filters further.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Sanity check the matcher syntax**

Run: `node -e "console.log('matcher ok')"` (just to confirm Node can parse the file via Next — real verification happens when dev server runs in Task 13).

Expected: no output errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/middleware.ts
git commit -m "feat(admin): wire API proxy middleware (/api /auth /uploads /ws → REMOTE_API_URL)"
```

---

## Task 4: Globals, theme provider, root layout

**Files:**
- Create: `apps/admin/app/globals.css`
- Create: `apps/admin/components/theme-provider.tsx`
- Create: `apps/admin/app/layout.tsx`
- Create: `apps/admin/features/auth/auth-cookie.ts`
- Create: `apps/admin/app/providers.tsx`
- Create: `apps/admin/platform/navigation.tsx`

- [ ] **Step 1: Create `apps/admin/app/globals.css`** (subset of apps/web — no landing-light)

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "../../../packages/ui/styles/tokens.css";
@import "../../../packages/ui/styles/base.css";

@custom-variant dark (&:is(.dark *));

@source "../../../packages/ui/**/*.{ts,tsx}";
@source "../../../packages/core/**/*.{ts,tsx}";
@source "../../../packages/views/**/*.{ts,tsx}";
```

- [ ] **Step 2: Create `apps/admin/components/theme-provider.tsx`** (clone from apps/web)

First inspect the source:

```bash
cat apps/web/components/theme-provider.tsx
```

Then write the same content to `apps/admin/components/theme-provider.tsx`. (It's a thin next-themes wrapper — typically ~15 lines.)

- [ ] **Step 3: Create `apps/admin/features/auth/auth-cookie.ts`** (clone from apps/web)

```bash
cat apps/web/features/auth/auth-cookie.ts
```

Copy verbatim to `apps/admin/features/auth/auth-cookie.ts`. (Contains `setLoggedInCookie` / `clearLoggedInCookie` helpers that set a `logged_in` cookie for the server-side auth gate.)

- [ ] **Step 4: Create `apps/admin/platform/navigation.tsx`**

Verbatim copy of `apps/web/platform/navigation.tsx` (already read in pre-plan exploration — it defines `WebNavigationProvider` adapting `next/navigation` into `@multica/views/navigation`'s `NavigationAdapter`).

- [ ] **Step 5: Create `apps/admin/app/providers.tsx`** (slimmed from apps/web — drops PageviewTracker and CostrictEmbedSync which are web-only)

```tsx
"use client";

import { useMemo } from "react";
import { CoreProvider } from "@multica/core/platform";
import { createBrowserCookieLocaleAdapter } from "@multica/core/i18n/browser";
import type { LocaleResources, SupportedLocale } from "@multica/core/i18n";
import { useWelcomeStore } from "@multica/core/onboarding";
import packageJson from "../package.json";
import { AdminNavigationProvider } from "@/platform/navigation";
import { setLoggedInCookie, clearLoggedInCookie } from "@/features/auth/auth-cookie";

function hasLegacyToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem("multica_token"));
  } catch {
    return false;
  }
}

function deriveWsUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return undefined;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const apiPath = process.env.NEXT_PUBLIC_API_URL || "";
  const wsPath = apiPath && apiPath.startsWith("/") ? `${apiPath}/ws` : "/ws";
  return `${proto}//${window.location.host}${wsPath}`;
}

const ADMIN_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version || "dev";

export function AdminProviders({
  children,
  locale,
  resources,
}: {
  children: React.ReactNode;
  locale: SupportedLocale;
  resources: Record<string, LocaleResources>;
}) {
  const cookieAuth = !hasLegacyToken();
  const identity = useMemo(
    () => ({ platform: "admin" as const, version: ADMIN_VERSION }),
    [],
  );
  const localeAdapter = useMemo(() => createBrowserCookieLocaleAdapter(), []);
  return (
    <CoreProvider
      apiBaseUrl={process.env.NEXT_PUBLIC_API_URL}
      wsUrl={deriveWsUrl()}
      cookieAuth={cookieAuth}
      onLogin={setLoggedInCookie}
      onLogout={() => {
        useWelcomeStore.getState().reset();
        clearLoggedInCookie();
      }}
      identity={identity}
      locale={locale}
      resources={resources}
      localeAdapter={localeAdapter}
    >
      <AdminNavigationProvider>{children}</AdminNavigationProvider>
    </CoreProvider>
  );
}
```

> The class `AdminNavigationProvider` is exported from `@/platform/navigation` — rename the export in navigation.tsx from `WebNavigationProvider` to `AdminNavigationProvider` when you copy it (or just keep the name `WebNavigationProvider` and update the import here — either is fine; rename is clearer).

- [ ] **Step 6: Create `apps/admin/app/layout.tsx`** (root layout, slimmed from apps/web)

```tsx
import type { Metadata, Viewport } from "next";
import { headers, cookies } from "next/headers";
import { Inter, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { cn } from "@multica/ui/lib/utils";
import { AdminProviders } from "@/app/providers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@multica/core/i18n";
import { RESOURCES } from "@multica/views/locales";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  fallback: [
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "PingFang SC",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "sans-serif",
  ],
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#05070b" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Multica Admin",
    template: "%s | Multica Admin",
  },
  description: "Multica Admin — operations console for human + agent teams.",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/favicon.svg"],
  },
};

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return (
    value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

const HTML_LANG: Record<SupportedLocale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const headerLocale = h.get("x-multica-locale");
  const cookieLocale = (await cookies()).get("multica-locale")?.value ?? null;
  const locale: SupportedLocale = isSupportedLocale(headerLocale)
    ? headerLocale
    : isSupportedLocale(cookieLocale)
      ? cookieLocale
      : DEFAULT_LOCALE;
  const resources = { [locale]: RESOURCES[locale] };

  return (
    <html
      lang={HTML_LANG[locale]}
      suppressHydrationWarning
      className={cn(
        "antialiased font-sans h-full",
        inter.variable,
        geistMono.variable,
      )}
    >
      <body className="h-full overflow-hidden">
        <ThemeProvider>
          <AdminProviders locale={locale} resources={resources}>
            {children}
          </AdminProviders>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin): root layout, providers, theme, globals, navigation adapter"
```

---

## Task 5: Root entry pages (redirect, not-found, favicon)

**Files:**
- Create: `apps/admin/app/page.tsx`
- Create: `apps/admin/app/not-found.tsx`
- Create: `apps/admin/app/favicon.ico/route.ts`

- [ ] **Step 1: Create `apps/admin/app/page.tsx`** (server-side redirect using the same cookie logic as apps/web)

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const cookieStore = await cookies();
  const lastWorkspaceSlug = cookieStore.get("last_workspace_slug")?.value;

  if (lastWorkspaceSlug) {
    redirect(`/${lastWorkspaceSlug}/issues`);
  }
  redirect("/login");
}
```

- [ ] **Step 2: Create `apps/admin/app/not-found.tsx`**

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">404 — Page not found</h1>
      <p className="text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
      >
        Go home
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Create `apps/admin/app/favicon.ico/route.ts`** (simple redirect to a shared SVG; apps/web has its own copy)

```ts
import { NextResponse } from "next/server";

// Serve the favicon from the monorepo's shared public assets.
// apps/web has the same route; we point at the same upstream file.
export function GET() {
  return NextResponse.redirect(new URL("/favicon.svg", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100"));
}
```

> If typecheck complains that `favicon.svg` doesn't exist in apps/admin/public, copy `apps/web/public/favicon.svg` to `apps/admin/public/favicon.svg` as part of this step.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin): root page redirect, 404, favicon route"
```

---

## Task 6: Coming Soon component + sidebar config

**Files:**
- Create: `apps/admin/components/layout/coming-soon.tsx`
- Create: `apps/admin/components/layout/sidebar-config.ts`

- [ ] **Step 1: Create `apps/admin/components/layout/coming-soon.tsx`**

```tsx
import { Construction } from "lucide-react";

interface ComingSoonProps {
  /** Module key, for future analytics / deep linking */
  module?: string;
  /** Display label shown to the user */
  label: string;
}

/**
 * Placeholder for pages scheduled in Phases 1–7 of the admin UI program.
 * Rendered by every page.tsx whose underlying view doesn't exist yet.
 */
export function ComingSoon({ module, label }: ComingSoonProps) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-module={module}
    >
      <Construction className="size-10 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          此页面正在开发中 / This page is under construction.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/admin/components/layout/sidebar-config.ts`** (single source of truth for the 32 routes)

```ts
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
  MonitorSmartphone,
  Plug,
  Bell,
  Ruler,
  IdCard,
  CreditCard,
  Notifications,
  Laptop,
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

// Home is rendered as a standalone top item, not inside any group.
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
      { href: "/admin/devices", labelZh: "设备管理", labelEn: "Devices", icon: MonitorSmartphone },
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
      { href: "/me/profile", labelZh: "我的资料", labelEn: "Profile", icon: IdCard },
      { href: "/me/quota", labelZh: "我的配额", labelEn: "My Quota", icon: CreditCard },
      { href: "/me/notifications", labelZh: "我的通知", labelEn: "Notifications", icon: Notifications },
      { href: "/me/devices", labelZh: "我的设备", labelEn: "My Devices", icon: Laptop },
      { href: "/me/preferences", labelZh: "偏好设置", labelEn: "Preferences", icon: SlidersHorizontal },
    ],
  },
];
```

- [ ] **Step 3: Typecheck the sidebar config**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS (no type errors). If lucide icon names don't exist, swap to closest available (e.g., `Gem` → `BadgeCheck`).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/components/layout/
git commit -m "feat(admin): ComingSoon placeholder + sidebar config (32 routes, single source of truth)"
```

---

## Task 7: AdminSidebar component

**Files:**
- Create: `apps/admin/components/layout/admin-sidebar.tsx`

This is the shadcn-admin-inspired collapsible sidebar. It uses `@multica/ui`'s sidebar primitives (which already exist) — no new shadcn/ui install needed.

- [ ] **Step 1: Read the existing sidebar primitives to confirm exports**

Run: `head -20 packages/ui/components/ui/sidebar.tsx`
Expected: exports include `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarRail`, `SidebarProvider`, `SidebarInset`, `SidebarTrigger`.

If any are missing, fall back to a minimal layout without those pieces.

- [ ] **Step 2: Create `apps/admin/components/layout/admin-sidebar.tsx`**

```tsx
"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AppLink } from "@multica/views/navigation";
import { useCurrentWorkspace } from "@multica/core/paths";
import { useAuthStore } from "@multica/core/auth";
import { useLogout } from "@multica/views/auth";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@multica/ui/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@multica/ui/components/ui/collapsible";
import { HOME_NAV, NAV_GROUPS, type NavGroup } from "./sidebar-config";

// Default to collapsed for low-frequency groups; expanded for primary ones.
const DEFAULT_OPEN: Record<string, boolean> = {
  workbench: true,
  projects: true,
  collaboration: true,
  repository: true,
  metrics: false,
  admin: false,
  me: false,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "") {
    // Home is active only on the exact workspace root.
    return /\/[^/]+\/?$/.test(pathname) && !pathname.includes("/", 1);
  }
  return pathname === href || pathname.startsWith(href + "/");
}

function GroupBlock({
  group,
  baseHref,
  pathname,
}: {
  group: NavGroup;
  baseHref: string;
  pathname: string;
}) {
  const [open, setOpen] = useState(DEFAULT_OPEN[group.id] ?? true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="flex w-full items-center justify-between">
            <span>{group.labelZh}</span>
            <ChevronRight className="size-3 transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const href = `${baseHref}${item.href}`;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive(pathname, href)}
                      render={<AppLink href={href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.labelZh}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const workspace = useCurrentWorkspace();
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  // Base href for the current workspace, e.g. "/my-team".
  // useCurrentWorkspace() returns null during initial load; fall back to "".
  const baseHref = workspace?.slug ? `/${workspace.slug}` : "";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <MulticaIcon className="size-6" />
          <span className="text-sm font-semibold">Multica Admin</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive(pathname, `${baseHref}/`)}
                  render={<AppLink href={`${baseHref}/`} />}
                >
                  <HOME_NAV.icon className="size-4" />
                  <span>{HOME_NAV.labelZh}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {NAV_GROUPS.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            baseHref={baseHref}
            pathname={pathname}
          />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled={!user}
              onClick={() => void logout()}
            >
              <ActorAvatar actor={user} className="size-6" />
              <span>{user?.name ?? "…"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
```

> Notes for the implementer:
> - `useCurrentWorkspace()` may return `{ id, slug, name, ... }` or just the slug string — check `packages/core/paths` and adapt. If it returns a string, use it directly: `const slug = useCurrentWorkspace(); const baseHref = slug ? \`/${slug}\` : "";`
> - `useLogout` may be a hook returning a function or a function itself — check `@multica/views/auth` exports.
> - `ActorAvatar` props may differ — verify against `packages/ui/components/common/actor-avatar.tsx`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS. Fix any prop mismatches against actual signatures in `@multica/ui` and `@multica/core`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/components/layout/admin-sidebar.tsx
git commit -m "feat(admin): AdminSidebar with 7 collapsible groups + 32 nav items"
```

---

## Task 8: Workspace layout + dashboard layout

**Files:**
- Create: `apps/admin/app/[workspaceSlug]/layout.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/layout.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/loading.tsx`

- [ ] **Step 1: Create `apps/admin/app/[workspaceSlug]/layout.tsx`** (clone of apps/web's, since the workspace resolution logic is identical)

Verbatim copy of `apps/web/app/[workspaceSlug]/layout.tsx`. (Already read during plan exploration — it resolves the slug via React Query, gates on auth, sets the workspace cookie, and wraps children in `WorkspaceSlugProvider`.)

```bash
cp apps/web/app/[workspaceSlug]/layout.tsx apps/admin/app/[workspaceSlug]/layout.tsx
```

> No content changes needed — every import (`@multica/core/paths`, `@multica/core/platform`, `@multica/views/workspace/no-access-page`, etc.) is already workspace-abstract.

- [ ] **Step 2: Create `apps/admin/app/[workspaceSlug]/(dashboard)/layout.tsx`** (admin's own — uses AdminSidebar instead of the shared AppSidebar)

```tsx
"use client";

import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { DashboardGuard } from "@multica/views/layout";
import { WorkspacePresencePrefetch } from "@multica/views/workspace-presence-prefetch";
import { ModalRegistry } from "@multica/views/modals/registry";
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";
import { AdminSidebar } from "@/components/layout/admin-sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="flex h-svh items-center justify-center">
          <MulticaIcon className="size-6 animate-pulse" />
        </div>
      }
    >
      <SidebarProvider className="h-svh">
        <WorkspacePresencePrefetch />
        <AdminSidebar />
        <SidebarInset className="relative overflow-hidden">
          {children}
          <ModalRegistry />
        </SidebarInset>
      </SidebarProvider>
    </DashboardGuard>
  );
}
```

> Note: we don't render `ChatWindow` / `ChatFab` / `SearchCommand` here — those are apps/web concerns. If a later phase wants them, add them then. `ModalRegistry` is kept because modals like CreateIssue may be triggered from within reused views.

- [ ] **Step 3: Create `apps/admin/app/[workspaceSlug]/(dashboard)/loading.tsx`**

```tsx
import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <MulticaIcon className="size-6 animate-pulse" />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): workspace + dashboard layouts using AdminSidebar"
```

---

## Task 9: Auth routes (login, invite, invitations, callback)

**Files:**
- Create: `apps/admin/app/(auth)/login/page.tsx`
- Create: `apps/admin/app/(auth)/invite/[id]/page.tsx`
- Create: `apps/admin/app/(auth)/invitations/page.tsx`
- Create: `apps/admin/app/auth/callback/page.tsx`

- [ ] **Step 1: Copy each auth page from apps/web**

```bash
mkdir -p apps/admin/app/\(auth\)/login
mkdir -p apps/admin/app/\(auth\)/invite/\[id\]
mkdir -p apps/admin/app/\(auth\)/invitations
mkdir -p apps/admin/app/auth/callback

cp "apps/web/app/(auth)/login/page.tsx" "apps/admin/app/(auth)/login/page.tsx"
cp "apps/web/app/(auth)/invite/[id]/page.tsx" "apps/admin/app/(auth)/invite/[id]/page.tsx"
cp "apps/web/app/(auth)/invitations/page.tsx" "apps/admin/app/(auth)/invitations/page.tsx"
cp "apps/web/app/auth/callback/page.tsx" "apps/admin/app/auth/callback/page.tsx"
```

> These pages are pure re-exports of `LoginPage`, `InvitePage`, `InvitationsPage` from `@multica/views/*` and contain no web-specific code. Verbatim copy works.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): auth routes (login, invite, invitations, callback) — verbatim from apps/web"
```

---

## Task 10: Home + Workbench routes (4 pages)

**Files:**
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx` (Home — Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/sessions/page.tsx` (Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/tasks/page.tsx` (re-export MyIssuesPage)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx` (Coming Soon)

- [ ] **Step 1: Home page (Coming Soon for now — Phase 1 will build it)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";

export default function HomePage() {
  return <ComingSoon module="home" label="首页 / Home" />;
}
```

- [ ] **Step 2: Sessions page (Coming Soon)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/sessions/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";

export default function SessionsPage() {
  return <ComingSoon module="sessions" label="我的会话 / Sessions" />;
}
```

- [ ] **Step 3: Tasks page (re-export MyIssuesPage)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/tasks/page.tsx
"use client";

import { MyIssuesPage } from "@multica/views/my-issues";

export default function Page() {
  return <MyIssuesPage />;
}
```

- [ ] **Step 4: Reviews page (Coming Soon)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/reviews/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";

export default function ReviewsPage() {
  return <ComingSoon module="reviews" label="我的审查 / Reviews" />;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Home + Workbench routes (sessions/tasks/reviews)"
```

---

## Task 11: Projects routes (6 pages)

**Files:**
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/projects/page.tsx` (re-export ProjectsPage)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/projects/backlog/page.tsx` (Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/issues/page.tsx` (re-export IssuesPage)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/issues/[id]/page.tsx` (re-export IssueDetail)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/design/page.tsx` (Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/review/page.tsx` (Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/projects/settings/page.tsx` (Coming Soon)

- [ ] **Step 1: Projects overview**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/projects/page.tsx
"use client";

import { ProjectsPage } from "@multica/views/projects/components";

export default function Page() {
  return <ProjectsPage />;
}
```

- [ ] **Step 2: Backlog (Coming Soon)**

```tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="backlog" label="待办 / Backlog" />;
}
```

- [ ] **Step 3: Issues list (re-export)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/issues/page.tsx
"use client";

import { IssuesPage } from "@multica/views/issues/components";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <IssuesPage />
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Issues detail (re-export)**

```tsx
// apps/admin/app/[workspaceSlug]/(dashboard)/issues/[id]/page.tsx
"use client";

import { use } from "react";
import { IssueDetail } from "@multica/views/issues/components";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <IssueDetail issueId={id} />;
}
```

> Verify `IssueDetail`'s prop name — it might be `issueId` or `id`. Check `packages/views/issues/components/index.ts` (already read: exports `IssueDetail`).

- [ ] **Step 5: Design, Review, Project Settings (all Coming Soon)**

```tsx
// design/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="design" label="设计 / Design" />;
}
```

```tsx
// review/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="review" label="审查 / Review" />;
}
```

```tsx
// projects/settings/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="projects-settings" label="项目设置 / Project Settings" />;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Projects routes (overview/backlog/issues/design/review/settings)"
```

---

## Task 12: Collaboration routes (3 pages)

**Files:**
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/workflows/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/workflows/[id]/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/workflows/[id]/runs/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/workflows/[id]/runs/[runId]/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/squads/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/squads/[id]/page.tsx`
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/dispatch/page.tsx` (Coming Soon)

- [ ] **Step 1: Workflows list**

```tsx
"use client";

import { WorkflowsPage } from "@multica/views/workflows/components";

export default function Page() {
  return <WorkflowsPage />;
}
```

- [ ] **Step 2: Workflow detail**

```tsx
"use client";

import { use } from "react";
import { WorkflowDetailShell } from "@multica/views/workflows/components";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <WorkflowDetailShell workflowId={id} />;
}
```

- [ ] **Step 3: Workflow runs list**

```tsx
"use client";

import { use } from "react";
import { WorkflowRunsPage } from "@multica/views/workflows/components";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <WorkflowRunsPage workflowId={id} />;
}
```

- [ ] **Step 4: Workflow single run**

```tsx
"use client";

import { use } from "react";
import { WorkflowRunPage } from "@multica/views/workflows/components";

export default function Page({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = use(params);
  return <WorkflowRunPage workflowId={id} runId={runId} />;
}
```

- [ ] **Step 5: Squads list**

```tsx
"use client";

import { SquadsPage } from "@multica/views/squads";

export default function Page() {
  return <SquadsPage />;
}
```

- [ ] **Step 6: Squad detail**

```tsx
"use client";

import { use } from "react";
import { SquadDetailPage } from "@multica/views/squads";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SquadDetailPage squadId={id} />;
}
```

> Verify the prop name (`squadId` vs `id`) by checking `packages/views/squads/index.ts` exports.

- [ ] **Step 7: Dispatch (Coming Soon)**

```tsx
import { ComingSoon } from "@/components/layout/coming-soon";

export default function Page() {
  return <ComingSoon module="dispatch" label="任务委派 / Dispatch" />;
}
```

- [ ] **Step 8: Typecheck (catch any prop mismatches early)**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS. Fix any prop name mismatches by checking actual view signatures.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Collaboration routes (workflows tree, squads, dispatch)"
```

---

## Task 13: Repository routes (3 pages)

**Files:**
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/wiki/page.tsx` (Coming Soon)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/skills/page.tsx` (re-export)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/skills/[id]/page.tsx` (re-export)
- Create: `apps/admin/app/[workspaceSlug]/(dashboard)/memory/page.tsx` (Coming Soon)

- [ ] **Step 1: Wiki (Coming Soon)**

```tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="wiki" label="知识 / Wiki" />;
}
```

- [ ] **Step 2: Skills list**

```tsx
"use client";

import { SkillsPage } from "@multica/views/skills";

export default function Page() {
  return <SkillsPage />;
}
```

- [ ] **Step 3: Skill detail**

```tsx
"use client";

import { use } from "react";
import { SkillDetailPage } from "@multica/views/skills";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <SkillDetailPage skillId={id} />;
}
```

- [ ] **Step 4: Memory (Coming Soon)**

```tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="memory" label="记忆 / Memory" />;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Repository routes (wiki/skills/memory)"
```

---

## Task 14: Metrics routes (5 pages, all Coming Soon)

**Files:**
- Create 5 files under `apps/admin/app/[workspaceSlug]/(dashboard)/metrics/`

- [ ] **Step 1: Create all 5 metrics pages with Coming Soon**

Each file follows the same pattern, only differing in `module` and `label`:

```tsx
// efficiency/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="metrics-efficiency" label="效能 / Efficiency" />;
}
```

```tsx
// quality/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="metrics-quality" label="质量 / Quality" />;
}
```

```tsx
// cost/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="metrics-cost" label="成本 / Cost" />;
}
```

```tsx
// coverage/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="metrics-coverage" label="覆盖 / Coverage" />;
}
```

```tsx
// contribution/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon module="metrics-contribution" label="贡献 / Contribution" />;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Metrics routes (5 Coming Soon pages)"
```

---

## Task 15: Admin routes (6 pages)

**Files:**
- Create `apps/admin/app/[workspaceSlug]/(dashboard)/admin/members/page.tsx` (re-export)
- Create `apps/admin/app/[workspaceSlug]/(dashboard)/admin/members/[id]/page.tsx` (re-export)
- Create `apps/admin/app/[workspaceSlug]/(dashboard)/admin/{permissions,devices,connectors,channels,quotas}/page.tsx` (Coming Soon × 5)

- [ ] **Step 1: Members list**

```tsx
"use client";

import { MembersPage } from "@multica/views/members";

export default function Page() {
  return <MembersPage />;
}
```

- [ ] **Step 2: Member detail**

```tsx
"use client";

import { use } from "react";
import { MemberDetailPage } from "@multica/views/members";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <MemberDetailPage userId={id} />;
}
```

> Verify the prop name (`userId` vs `memberId` vs `id`) by reading `packages/views/members/index.ts`.

- [ ] **Step 3: 5 Coming Soon pages** (permissions, devices, connectors, channels, quotas)

Same pattern — vary the module/label:

- `permissions/page.tsx`: `module="admin-permissions" label="权限管理 / Permissions"`
- `devices/page.tsx`: `module="admin-devices" label="设备管理 / Devices"`
- `connectors/page.tsx`: `module="admin-connectors" label="集成 / Connectors"`
- `channels/page.tsx`: `module="admin-channels" label="通知渠道 / Channels"`
- `quotas/page.tsx`: `module="admin-quotas" label="配额策略 / Quotas"`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/app/
git commit -m "feat(admin): Admin routes (members re-export + 5 Coming Soon)"
```

---

## Task 16: Me routes (5 pages)

**Files:**
- Create `apps/admin/app/[workspaceSlug]/(dashboard)/me/{profile,quota,notifications,devices,preferences}/page.tsx`

- [ ] **Step 1: Profile page (deep-link into SettingsPage with `?tab=profile`)**

```tsx
"use client";

import { SettingsPage } from "@multica/views/settings";

export default function Page() {
  // SettingsPage reads ?tab= from useSearchParams internally.
  // Force the profile tab by rendering it with the query param preset via URL.
  return <SettingsPage />;
}
```

> If `SettingsPage` doesn't pick up the tab from the URL automatically, wrap it with a `useEffect` that calls `router.replace('?tab=profile')` on mount. Verify by reading `packages/views/settings/components/settings-page.tsx` — the original reads `TAB_QUERY_KEY = "tab"` from `useSearchParams`, so the URL-based approach works. Document this as the link target: `/me/profile?tab=profile`.

Update `sidebar-config.ts` for the profile entry to include the query param:

```ts
{ href: "/me/profile?tab=profile", labelZh: "我的资料", labelEn: "Profile", icon: IdCard },
```

- [ ] **Step 2: Preferences page (also deep-links SettingsPage)**

```tsx
"use client";

import { SettingsPage } from "@multica/views/settings";

export default function Page() {
  return <SettingsPage />;
}
```

Update `sidebar-config.ts`:

```ts
{ href: "/me/preferences?tab=preferences", labelZh: "偏好设置", labelEn: "Preferences", icon: SlidersHorizontal },
```

- [ ] **Step 3: Quota, Notifications, Devices (Coming Soon)**

- `quota/page.tsx`: `module="me-quota" label="我的配额 / My Quota"`
- `notifications/page.tsx`: `module="me-notifications" label="我的通知 / Notifications"`
- `devices/page.tsx`: `module="me-devices" label="我的设备 / My Devices"`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin): Me routes (profile/preferences re-export + 3 Coming Soon)"
```

---

## Task 17: README

**Files:**
- Create: `apps/admin/README.md`

- [ ] **Step 1: Create `apps/admin/README.md`**

````markdown
# Multica Admin

Operations console for Multica. Built on the same `@multica/{core, ui, views}` packages as `apps/web`, but with an admin-focused sidebar covering all 32 planned routes across 8 product modules.

## Status

**Phase 0 (Foundation)** — this app is a skeleton:

- ✅ 32 routes accessible
- ✅ 10 routes re-export real views (issues, projects, workflows, skills, members, settings tabs, my-issues, squads)
- ✅ 22 routes show a Coming Soon placeholder
- ✅ Sidebar with 7 collapsible nav groups + Home
- ✅ Auth flow (login, invite, invitations, OAuth callback)
- ✅ Connects to the real backend via `middleware.ts` → `REMOTE_API_URL`

Subsequent phases will replace the Coming Soon pages with real implementations. See `docs/superpowers/specs/2026-07-21-multica-admin-ui-design.md` for the master spec.

## Development

```bash
# Terminal 1: start the backend
make server

# Terminal 2: start admin (port 3100)
pnpm dev --filter @multica/admin
# Or:
FRONTEND_PORT=3100 pnpm dev --filter @multica/admin
```

Open <http://localhost:3100>.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `REMOTE_API_URL` | `http://localhost:8080` | Backend URL, proxied by middleware.ts |
| `FRONTEND_PORT` | `3100` | Dev server port |
| `NEXT_PUBLIC_API_URL` | (empty) | If set, used directly by the API client instead of `/api` proxy |
| `NEXT_PUBLIC_WS_URL` | (derived) | WebSocket URL |
| `NEXT_PUBLIC_BASE_PATH` | (empty) | Subpath prefix if mounted under a path |

## Architecture

- Next.js App Router (same as apps/web)
- `@multica/core` for API client, stores, types
- `@multica/ui` for shadcn-style components (Base UI primitives)
- `@multica/views` for shared business pages

The admin-specific sidebar (`components/layout/admin-sidebar.tsx`) is local to this app; the shared `AppSidebar` in `@multica/views/layout` is untouched so apps/web keeps working.
````

- [ ] **Step 2: Commit**

```bash
git add apps/admin/README.md
git commit -m "docs(admin): README for Phase 0"
```

---

## Task 18: Verification

This task is the spec's acceptance criteria checklist. Run all of them. If any fails, fix and re-run.

- [ ] **Step 1: typecheck**

Run: `pnpm --filter @multica/admin typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 2: lint**

Run: `pnpm --filter @multica/admin lint`
Expected: PASS. Fix any warnings/errors.

- [ ] **Step 3: build**

Run: `pnpm --filter @multica/admin build`
Expected: build succeeds, `.next/` populated. Common failures:
- Missing import: add to package.json deps
- Type mismatch in re-exported view props: check actual signature and adapt

- [ ] **Step 4: Manual smoke test — backend + dev server**

```bash
# Terminal 1
make server

# Terminal 2
pnpm --filter @multica/admin dev
```

Open <http://localhost:3100>. Verify:
- [ ] Redirects to `/login` if not authenticated
- [ ] Login flow works (use any email + verification code — backend prints codes to stdout when `RESEND_API_KEY` is empty)
- [ ] After login, lands on `/[workspace]/...` with sidebar visible
- [ ] Sidebar shows 8 sections (Home + 7 groups) with correct Chinese labels and icons
- [ ] Click `工作流 / Workflows` → loads real workflows from backend
- [ ] Click `技能 / Skills` → loads real skills
- [ ] Click `组织成员 / Members` → loads real members
- [ ] Click `需求 / Issues` → loads real issues
- [ ] Click `我的审查 / Reviews` → shows Coming Soon
- [ ] Click `知识 / Wiki` → shows Coming Soon
- [ ] Theme toggle (if header rendered) switches dark/light
- [ ] No console errors in DevTools

- [ ] **Step 5: Verify apps/web still works (regression check)**

Run: `pnpm --filter @multica/web typecheck && pnpm --filter @multica/web build`
Expected: PASS. apps/web must be unaffected by admin's existence.

- [ ] **Step 6: Final commit + push**

```bash
git add -A
git commit --allow-empty -m "chore(admin): Phase 0 verification complete

All acceptance criteria from spec §9 verified:
- typecheck/lint/build pass
- dev server runs on :3100
- backend proxy works (real data on 10 routes)
- 22 Coming Soon placeholders render
- apps/web regression-free"
```

If working on a feature branch, push: `git push -u origin new-ui-demo`.

---

## Self-Review

### 1. Spec coverage

Walk through spec §9 acceptance criteria:

| Criterion | Task |
|---|---|
| apps/admin/ created, package.json registered | Task 1 |
| `pnpm dev --filter @multica/admin` runs on 3100 | Task 18 Step 4 |
| middleware.ts proxy works, login via real backend | Task 3 + Task 18 Step 4 |
| Sidebar 7 nav-groups, Chinese labels, correct icons | Task 6 + Task 7 |
| Header search/theme/profile | (partial — see gap below) |
| 32 routes accessible (10 re-export, 22 Coming Soon) | Tasks 10–16 |
| Dark/light theme toggle works | Task 4 (ThemeProvider wired) + Task 18 Step 4 |
| typecheck/lint/build pass | Task 18 Steps 1–3 |
| README documents Phase 0 | Task 17 |

**Gap identified:** Header with search/theme-switch/profile-dropdown is mentioned in spec §5.2 and §9 but **not** implemented in this plan. The current `(dashboard)/layout.tsx` only renders `AdminSidebar` + `SidebarInset` without a header bar.

**Resolution:** This is acceptable for Phase 0 — the sidebar already contains the user info in its footer (Task 7) and theme switching works via next-themes (just no visible toggle yet). The header is scheduled for Phase 1 alongside Home. Add a note in README and to the spec's §9 acceptance criteria that "header with search/theme/profile" is deferred to Phase 1.

**Action:** Update spec §9 to mark "Header" as Phase 1 scope, not Phase 0. (Self-review fix — done inline below.)

### 2. Placeholder scan

Searched plan for: "TBD", "TODO", "implement later", "fill in details", "add appropriate", "similar to". None found except where intentional (e.g., "coming soon" is the actual product feature).

### 3. Type consistency

- `ComingSoon` props: `module: string, label: string` — used consistently in Tasks 6, 10–16. ✓
- `NavItem.href` (string, relative) and `NavGroup.items` — consistent. ✓
- `AdminSidebar` uses `useCurrentWorkspace()` — the return shape is uncertain (object vs string). Flagged in Task 7 Step 2 notes. This is a known implementation-time check, not a plan inconsistency.
- Re-exported view prop names (`issueId`, `workflowId`, `squadId`, `skillId`, `userId`) — flagged for verification in their respective tasks. This is correct: we can't know without running typecheck, which is why each task that introduces a re-export ends with a typecheck step.

### Action items from self-review

1. **Spec §9 update** — defer "Header with search/theme/profile" from Phase 0 to Phase 1. (Apply after this plan is approved.)
2. No other changes needed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-21-multica-admin-phase0.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
