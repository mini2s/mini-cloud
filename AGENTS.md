# Repository Guidelines

This file provides guidance to AI agents when working with code in this repository.

> **Single source of truth:** This file is a concise pointer document.
> All authoritative architecture, coding rules, commands, and conventions
> live in **CLAUDE.md** at the project root. Read that file first.

## Quick Reference

### Architecture

Go backend + monorepo frontend (pnpm workspaces + Turborepo) with shared packages.

- `server/` — Go backend (Chi router, sqlc, gorilla/websocket)
- `apps/web/` — Next.js frontend (App Router)
- `apps/desktop/` — Electron desktop app
- `packages/core/` — Headless business logic (Zustand stores, React Query hooks, API client)
- `packages/ui/` — Atomic UI components (shadcn/Base UI, zero business logic)
- `packages/views/` — Shared business pages/components
- `packages/tsconfig/` — Shared TypeScript config

### State Management (critical)

- **React Query** owns all server state (issues, members, agents, inbox, workspace list)
- **Zustand** owns all client state (current workspace selection, view filters, drafts, modals)
- All Zustand stores live in `packages/core/` — never in `packages/views/` or app directories
- WS events invalidate React Query — never write directly to stores

### Package Boundaries (hard rules)

- `packages/core/` — zero react-dom, zero localStorage, zero process.env
- `packages/ui/` — zero `@multica/core` imports
- `packages/views/` — zero `next/*`, zero `react-router-dom`, use `NavigationAdapter` for routing
- `apps/web/platform/` — only place for Next.js APIs

### Commands

```bash
make dev              # Auto-setup + start everything
pnpm typecheck        # TypeScript check
pnpm test             # TS unit tests (Vitest)
make test             # Go tests
make check            # Full verification pipeline
```

See CLAUDE.md for the complete command reference.

### Git Safety (hard rules)

- Only local `main` may track `origin/main`; no feature, fix, docs, spec, or integration branch may track a protected base branch.
- Create branches from the remote base with `git switch --create <branch-name> --no-track origin/main`. Never use `git switch -c <branch-name> origin/main`.
- Immediately verify new branches with `git branch -vv`. If a non-main branch shows `[origin/main]` or `[origin/master]`, run `git branch --unset-upstream` and stop before any push.
- Never publish a new branch with an implicit `git push`. First run `git push --dry-run origin HEAD:refs/heads/<branch-name>`, then use `git push --set-upstream origin HEAD:refs/heads/<branch-name>` and require the remote destination name to match the current local branch.
- Never push to `main` or `master` unless the user explicitly authorizes that exact remote push in the current conversation. "Commit", "merge", "finish", and "integrate" are not push authorization.
- See `CLAUDE.md` section **Git Branch and Push Safety (hard rules)** for the complete policy.

### Troubleshooting

When debugging agent, daemon, or runtime issues, check logs in this order:

| Component | Location | How to view |
|---|---|---|
| **Daemon (default profile)** | `~/.multica/daemon.log` | `cs-workflow daemon logs -f --lines 100` |
| **Daemon (named profile)** | `~/.multica/profiles/<name>/daemon.log` | `cs-workflow daemon logs -f --lines 100 --profile <name>` |
| **Daemon (Desktop app)** | `~/.multica/profiles/desktop-<host>/daemon.log` | Desktop status bar → log panel |
| **Server (Docker)** | container stdout/stderr | `docker logs -f <container>` |
| **Server (systemd)** | journal | `journalctl -u multica-server -f` |
| **Server (dev)** | terminal stderr | Read directly from `make server` terminal |
| **Frontend (browser)** | DevTools → Console | Press `F12` |

Diagnosis order: daemon log → server log → cross-reference timelines to isolate the failing layer.

For foreground daemon (more verbose output): `cs-workflow daemon stop && cs-workflow daemon start --foreground`

See `apps/docs/content/docs/troubleshooting.mdx` for the full troubleshooting guide.
