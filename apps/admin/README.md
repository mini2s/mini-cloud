# Multica Admin

Operations console for Multica. Built on the same `@multica/{core, ui, views}` packages as `apps/web`, but with an admin-focused sidebar covering all 32 planned routes across 8 product modules (Home, Workbench, Projects, Collaboration, Repository, Metrics, Admin, Me).

## Status

**Phase 0 (Foundation)** — this app is a skeleton:

- ✅ 32 sidebar routes accessible (39 page.tsx files total, including detail pages)
- ✅ 10 routes re-export real views from `@multica/views` (issues, projects, workflows, skills, members, my-issues, squads, settings tabs)
- ✅ 22 routes show a Coming Soon placeholder
- ✅ Sidebar with 7 collapsible nav groups + Home (shadcn-admin-inspired visual style, built on `@multica/ui`)
- ✅ Auth flow (login, invite, invitations, OAuth callback) — reused verbatim from `@multica/views`
- ✅ Connects to the real backend via `middleware.ts` → `REMOTE_API_URL`
- ✅ Dark/light theme via `next-themes` (visible toggle scheduled for Phase 1 alongside the header bar)

Subsequent phases will replace Coming Soon pages with real implementations. See `docs/superpowers/specs/2026-07-21-multica-admin-ui-design.md` for the master spec and `docs/superpowers/plans/2026-07-21-multica-admin-phase0.md` for this phase's implementation plan.

## Development

```bash
# Terminal 1: start the backend
make server

# Terminal 2: start admin (port 3100)
pnpm dev --filter @multica/admin
# Or with explicit port:
FRONTEND_PORT=3100 pnpm dev --filter @multica/admin
```

Open <http://localhost:3100>.

### Smoke test

1. Backend must be running (`make server`) — admin has no mock layer.
2. Visit <http://localhost:3100> — should redirect to `/login` if not authenticated.
3. Login with any email; backend prints the verification code to stdout when `RESEND_API_KEY` is empty (or set `MULTICA_DEV_VERIFICATION_CODE=888888` in `.env` for deterministic local automation).
4. After login, lands on `/<workspace-slug>/...` with the admin sidebar visible.
5. Click around the 7 nav groups — `Workflows`, `Skills`, `组织成员`, `需求` should load real data; others show Coming Soon.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `REMOTE_API_URL` | `http://localhost:8080` | Backend URL, proxied by `middleware.ts` |
| `FRONTEND_PORT` | `3100` | Dev server port |
| `NEXT_PUBLIC_API_URL` | (empty) | If set, used directly by the API client instead of the `/api` proxy |
| `NEXT_PUBLIC_WS_URL` | (derived from page origin) | WebSocket URL |
| `NEXT_PUBLIC_BASE_PATH` | (empty) | Subpath prefix if mounted under a path |
| `CORS_ALLOWED_ORIGINS` | (empty) | Comma-separated origins; parsed into Next's `allowedDevOrigins` for HMR |
| `MULTICA_DEV_VERIFICATION_CODE` | (empty) | Fixed login code for local automation (ignored when `APP_ENV=production`) |

## Architecture

- **Next.js App Router** (same as `apps/web`)
- `@multica/core` for API client, stores, types
- `@multica/ui` for shadcn-style components (Base UI primitives)
- `@multica/views` for shared business pages — reused verbatim, zero modifications to the package

The admin-specific sidebar (`components/layout/admin-sidebar.tsx`) is local to this app and reads its nav schema from `components/layout/sidebar-config.ts` (single source of truth for all 32 routes). The shared `AppSidebar` in `@multica/views/layout` is untouched, so `apps/web` keeps working unchanged.

### File layout

```
apps/admin/
├── app/
│   ├── layout.tsx                    # Root: fonts, ThemeProvider, AdminProviders, Toaster
│   ├── providers.tsx                 # CoreProvider + AdminNavigationProvider
│   ├── page.tsx                      # / → redirect by last_workspace_slug cookie
│   ├── not-found.tsx
│   ├── (auth)/                       # Public routes (login, invite, invitations)
│   ├── auth/callback/page.tsx        # OAuth callback
│   └── [workspaceSlug]/
│       ├── layout.tsx                # Workspace resolver + WorkspaceSlugProvider
│       └── (dashboard)/
│           ├── layout.tsx            # DashboardGuard + SidebarProvider + AdminSidebar
│           ├── loading.tsx
│           └── ... 39 page.tsx files (10 re-exports, 29 Coming Soon / detail pages)
├── components/
│   └── layout/
│       ├── admin-sidebar.tsx         # 7 collapsible groups + Home + user footer
│       ├── sidebar-config.ts         # Nav schema (single source of truth)
│       ├── coming-soon.tsx           # Placeholder for Phase 1-7 pages
│       └── theme-provider.tsx
├── platform/navigation.tsx           # Next.js → @multica/views/navigation adapter
├── features/auth/auth-cookie.ts
├── middleware.ts                     # Proxy /api /auth /uploads /ws → REMOTE_API_URL
└── next.config.ts / tsconfig.json / etc.
```

## Phases

| Phase | Scope | Status |
|---|---|---|
| **0** | Foundation (this app) | ✅ Complete |
| 1 | Workbench (Home + Sessions/Tasks/Reviews) | Planned |
| 2 | Projects (Overview/Backlog/Issues/Design/Review/Settings) | Planned |
| 3 | Collaboration (Workflows/Squads/Dispatch) | Planned |
| 4 | Repository (Wiki/Skills/Memory) | Planned |
| 5 | Metrics (Efficiency/Quality/Cost/Coverage/Contribution) | Planned |
| 6 | Admin (Members/Permissions/Devices/Connectors/Channels/Quotas) | Planned |
| 7 | Me (Profile/Quota/Notifications/Devices/Preferences) | Planned |

Each phase gets its own spec under `docs/superpowers/specs/` and plan under `docs/superpowers/plans/`.
