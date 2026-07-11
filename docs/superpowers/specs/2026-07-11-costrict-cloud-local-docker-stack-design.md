# CoStrict Cloud Local Docker Stack — Design

**Date:** 2026-07-11
**Target repo:** `multica` (the personal, gitignored `docker-compose.local.yml`)
**Branch:** `feature/multica-org-integration`

## Context & Goal

The local dev stack at `multica/docker-compose.local.yml` already runs PostgreSQL +
multica backend/frontend + costrict-dept-sync (all built from local source). The goal is
to extend that same stack with the **CoStrict Cloud** product so it runs locally in
containers:

- **app-ai-native** — the CoStrict Cloud web frontend (Vite + SolidJS SPA, served by a
  bun process on port 3000). Source: `opencode/packages/app-ai-native`. Note: `costrict-web`'s
  "frontend" IS this package (costrict-web pulls it as a git submodule), so there is exactly
  one frontend to deploy.
- **costrict-web server** — the Go backend (`server/cmd/api`) the frontend proxies `/api`
  and `/cloud` to. Source: `costrict-web/server`.
- **casdoor** — the OIDC provider both services depend on. Image borrowed from
  `costrict-deploy-docker` (`zgsm/casdoor:v2.1.3`), seeded so login works out of the box.

Approach chosen: **build frontend + backend from local source, pull casdoor + redis images,
seed casdoor turnkey**. This matches the existing stack's build-from-source philosophy,
requires no registry credentials, and lets the developer iterate on local costrict-web /
opencode source.

## Architecture

```
                    ┌──────────────┐
   browser --:3001->│  cloud-web   │  app-ai-native (bun, container 3000 -> host 3001)
                    │  (frontend)  │  proxies /api and /cloud -> cloud-api:8080
                    └──────┬───────┘
                           │ (compose network)
                    ┌──────▼───────┐    ┌──────────┐
                    │  cloud-api   │--->│  redis   │ (new; used by cloud-api)
                    │ costrict-web │    └──────────┘
                    │   server     │    ┌──────────┐
                    │  (Go :8080)  │--->│ postgres │ (shared; adds costrict_db)
                    └──────┬───────┘    │  pg17    │
                           │            └────┬─────┘
                    ┌──────▼───────┐    ┌─────▼─────┐
   browser --:18000->│   casdoor   |--->│ casdoor db│ (new; seeded)
                    │ :8000        │    └───────────┘
                    └──────────────┘
```

All new services attach to the compose default network (services address each other by
service name). Host port publishing is `127.0.0.1`-only, consistent with the existing file.

## Services

### cloud-web (app-ai-native frontend)

- **Build:** `build.context: ../opencode`, `dockerfile: packages/app-ai-native/Dockerfile`.
  Context MUST be the opencode repo root (the Dockerfile `COPY`s root `package.json`,
  `bun.lock`, `patches/`, and sibling workspace packages `sdk/js`, `ui`, `util`).
- **Container port:** 3000 → **host `127.0.0.1:3001`** (3000 is taken by the multica
  frontend).
- **Runtime:** bun `script/server.ts` serves `dist/` and proxies `/api`, `/cloud`
  (incl. WebSocket) to `${VITE_CLOUD_SERVER_HOST}:${VITE_CLOUD_SERVER_PORT}`. Runtime config
  is injected by `docker-entrypoint.sh` via `envsubst` over `index.html` (`window.__ENV__`).
- **depends_on:** `cloud-api`.

### cloud-api (costrict-web server)

- **Build:** `build.context: ../costrict-web/server`, `dockerfile: Dockerfile`. The server
  module is self-contained (has its own `go.mod`); context does NOT need the repo root /
  `go.work`. The image bundles both `server` and `migrate` binaries and runs as non-root
  (uid 1000).
- **Container port:** 8080, **not published** to the host (the frontend reaches it over the
  compose network). Publish only if direct debugging is needed.
- **Auto-migrate:** on boot the API binary runs the bundled `./migrate` (pre-migrations →
  GORM AutoMigrate → goose migrations) unless `RUN_MIGRATIONS=false`. This creates the
  `costrict_db` schema including the `pg_trgm` extension.
- **depends_on:** `postgres` (service_healthy), `redis` (service_healthy), `casdoor`
  (service_started).

### casdoor

- **Image:** `zgsm/casdoor:v2.1.3` (the canonical tag from
  `costrict-deploy-docker/scripts/newest-images.list`).
- **Container port:** 8000 → **host `127.0.0.1:18000`** (matches the frontend default
  `VITE_CASDOOR_ENDPOINT=http://localhost:18000`).
- **Backend:** PostgreSQL `casdoor` database (see Postgres layout).
- **depends_on:** `postgres` (service_healthy).

### redis

- **Image:** `redis:7-alpine` (matches `costrict-web/docker-compose.yml`).
- **Container port:** 6379, not published. Used by cloud-api for the gateway registry store,
  rate limiter, and team module. (cloud-api falls back to a Postgres-backed store if redis
  is absent, so it is recommended but not strictly required.)
- Healthcheck: `redis-cli ping`.

## Postgres Database Layout (shared pg17)

The existing `postgres` service (`pgvector/pgvector:pg17`, creates db `multica` via
`POSTGRES_DB`) currently has **no** `docker-entrypoint-initdb.d` mount. Add a read-only
mount of a local initdb directory:

```yaml
volumes:
  - pgdata:/var/lib/postgresql/data
  - ./docker/local-stack/initdb:/docker-entrypoint-initdb.d:ro
```

Init scripts (run alphabetically on **first init only**):

- `10-create-databases.sql` — `CREATE DATABASE costrict_db; CREATE DATABASE casdoor;`
  (run as `POSTGRES_USER`, which the docker postgres image makes superuser, so `CREATE
  DATABASE` and `CREATE EXTENSION` succeed).
- `11-casdoor-seed.sql` — the casdoor schema + seed data, copied from
  `costrict-deploy-docker/config/postgres/initdb.d/11_casdoor_init.sql` (a 1728-line
  Navicat dump that begins with `\c casdoor;` so it loads into the `casdoor` db). Seeds the
  `built-in` and `costrict_group` organizations, the `app-built-in` and `costrict_login`
  applications, the `admin` user (`admin/123`), certs, casbin rules, etc.
- `12-casdoor-local-patch.sql` — starts with `\c casdoor;`, then a targeted `UPDATE` so the
  chosen application's `redirect_uris` includes the costrict-web callback (see Casdoor
  Bootstrap).

The `costrict_db` schema is NOT in these scripts — cloud-api's `migrate` binary creates it
on first boot.

> **First-run prerequisite:** initdb scripts only execute when the `pgdata` volume is empty.
> If a `pgdata` volume already exists from prior use, the new databases will not be created
> automatically — bring the stack down with `-v` (wiping the volume) or create the databases
> by hand. This caveat will be documented in the compose file header.

## Casdoor Bootstrap (turnkey login)

The seed dump gives a working casdoor with two orgs and two apps. To make login **work out
of the box without creating any user**, use the `built-in` organization + the `app-built-in`
application — the `admin/123` user already lives in `built-in`.

Credentials and org/app wiring (from the seeded `app-built-in` row):

| Variable | Value |
|---|---|
| `CASDOOR_CLIENT_ID` / `VITE_CASDOOR_CLIENT_ID` | `8dd1828f0bc708f64365` |
| `CASDOOR_CLIENT_SECRET` (server only) | `ab4af8f8748bce6756a3bc0c42ba41b716448fe7` |
| `CASDOOR_ORGANIZATION` / `VITE_CASDOOR_ORG_NAME` | `built-in` |
| `VITE_CASDOOR_APP_NAME` | `app-built-in` |
| `CASDOOR_ENDPOINT` / `VITE_CASDOOR_ENDPOINT` | `http://localhost:18000` (browser-facing) |
| `CASDOOR_INTERNAL_ENDPOINT` | `http://casdoor:8000` (container-to-container) |
| `CASDOOR_CALLBACK_URL` | `http://localhost:3001/api/auth/callback` |

The OAuth flow: browser → `cloud-web:3001` proxies `/api/auth/login` → `cloud-api` redirects
browser to casdoor → casdoor redirects back to `http://localhost:3001/api/auth/callback` →
`cloud-web` proxies to `cloud-api`, which exchanges the code (talking to
`http://casdoor:8000` internally) and sets the `zgsmAdminToken` cookie.

The seed dump's `app-built-in` ships with an empty `redirect_uris`, so the bootstrap patch
file sets it:

```sql
-- 12-casdoor-local-patch.sql
\c casdoor;
UPDATE application SET redirect_uris = '[".*/api/auth/callback"]' WHERE name = 'app-built-in';
```

(The `redirect_uris` column is a varchar holding a JSON-array string; casdoor matches each
entry as a regex, so `.*/api/auth/callback` matches `http://localhost:3001/api/auth/callback`.)

> **Alternative:** for a setup closer to production, switch to the `costrict_group`
> organization + `costrict_login` app (client `9e2fc5d4fbcd52ef4f6f` / secret
> `ab5d8ba28b0e6c0d6e971247cdc1deb269c9eea3`) and append the callback to its existing
> redirect URIs. This requires first adding a user to `costrict_group` (the seeded `admin`
> user is in `built-in`), so it is not the default.

### Fallback if the seed does not load cleanly

If the dump's schema does not match `zgsm/casdoor:v2.1.3` exactly and seed loading fails,
the fallback is to drop `11-casdoor-seed.sql`, let casdoor self-initialize on an empty
`casdoor` db, and do a one-time UI setup (log in `admin/123`, create the application with
the client id/secret and redirect URI above). The image version is expected to match the
dump (both `v2.1.3`-era, dump dated 2026-03-17), so this should not be needed.

## Environment Wiring

### cloud-api (key vars)

```
PORT=8080
DATABASE_URL=postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD:-multica}@postgres:5432/costrict_db?sslmode=disable
REDIS_URL=redis://redis:6379
COOKIE_SECURE=false                       # required for HTTP local stacks
CORS_ALLOWED_ORIGINS=http://localhost:3001
COSTRICT_CLOUD_BASE_URL=http://localhost:3001
FRONTEND_URLS=http://localhost:3001
CASDOOR_ENDPOINT=http://localhost:18000
CASDOOR_INTERNAL_ENDPOINT=http://casdoor:8000
CASDOOR_CLIENT_ID=8dd1828f0bc708f64365
CASDOOR_CLIENT_SECRET=ab4af8f8748bce6756a3bc0c42ba41b716448fe7
CASDOOR_ORGANIZATION=built-in
CASDOOR_CALLBACK_URL=http://localhost:3001/api/auth/callback
RUN_MIGRATIONS=true                       # auto-create costrict_db schema on boot
```

Optional wiring (leave empty to disable; degrade gracefully):
- `MULTICA_API_URL=http://backend:8080` — session permission checks against the multica
  backend (same stack). Leave empty if the multica backend does not implement the expected
  endpoints.
- `DEPT_SYNC_URL=http://costrict:8080` + `DEPT_SYNC_API_KEY=dev-query-key` — wire the admin
  dept-sync UI to the existing costrict-dept-sync service.
- `LLM_*` / `EMBEDDING_*` — only if AI assistant / semantic features are wanted.

### cloud-web (runtime env, applied by envsubst at container start)

```
VITE_CLOUD_SERVER_HOST=cloud-api
VITE_CLOUD_SERVER_PORT=8080
VITE_API_PREFIX=                          # empty -> proxy /api and /cloud directly
VITE_APP_URL=http://localhost:3001
VITE_CASDOOR_ENDPOINT=http://localhost:18000
VITE_CASDOOR_CLIENT_ID=8dd1828f0bc708f64365
VITE_CASDOOR_ORG_NAME=built-in
VITE_CASDOOR_APP_NAME=app-built-in
```

(`VITE_CASDOOR_CLIENT_SECRET` is intentionally NOT set on the frontend — the secret stays
server-side on cloud-api.)

## File Changes

All changes are in the `multica` repo and are **personal/local** (consistent with the
already-gitignored `docker-compose.local.yml`).

| File | Action |
|---|---|
| `multica/docker-compose.local.yml` | Add 4 services (`cloud-web`, `cloud-api`, `casdoor`, `redis`); add `initdb` volume mount to `postgres`; add `redis_data` volume. |
| `multica/docker/local-stack/initdb/10-create-databases.sql` | Create. |
| `multica/docker/local-stack/initdb/11-casdoor-seed.sql` | Create — copy of costrict-deploy-docker's casdoor dump. |
| `multica/docker/local-stack/initdb/12-casdoor-local-patch.sql` | Create — redirect_uris patch for `app-built-in`. |
| `multica/.gitignore` | Add `docker/local-stack/` so these personal files are not committed. |

The compose file is regenerated/edited in place; no template engine is involved (unlike
costrict-deploy-docker, the multica local stack is a plain compose file).

## First-Run & Day-to-Day Commands

```bash
# First run (fresh pgdata volume so initdb scripts execute):
docker compose -f docker-compose.local.yml up -d --build

# Rebuild after changing local costrict-web / opencode source:
docker compose -f docker-compose.local.yml up -d --build cloud-api cloud-web

# Follow logs:
docker compose -f docker-compose.local.yml logs -f cloud-api cloud-web casdoor

# Tear down (keeps volumes):
docker compose -f docker-compose.local.yml down

# Full reset incl. databases (re-runs initdb seeds):
docker compose -f docker-compose.local.yml down -v
```

Access points after start:
- CoStrict Cloud frontend: `http://localhost:3001`
- Casdoor admin: `http://localhost:18000` (login `admin` / `123`)
- cloud-api: internal only

## Risks & Verification

1. **casdoor dump vs `v2.1.3` schema mismatch** — if `11-casdoor-seed.sql` fails to load,
  fall back to the empty-db + one-time UI setup described above.
2. **Auth cookie pass-through** — cloud-web's bun proxy must forward the `Set-Cookie`
  (`zgsmAdminToken`) from cloud-api to the browser. Verify the full login round-trip: visit
  `http://localhost:3001` → redirected to casdoor → log in `admin/123` → redirected back,
  authenticated. `COOKIE_SECURE=false` is mandatory over HTTP.
3. **`costrict_db` migration on pg17** — cloud-api's `migrate` must run cleanly against the
  shared pg17 and create `pg_trgm`. The `POSTGRES_USER` is a superuser, so extension creation
  is allowed. Confirm via cloud-api logs ("migration complete"-equivalent) and that
  `cloud-api` becomes healthy/responding.
4. **Initdb only on fresh volume** — documented; require `down -v` for a clean first init.
5. **`/cloud` WebSocket / SSE** — long-lived connections; no server-side timeout is set in
  the Go server. If anything is ever put in front of cloud-api, raise proxy read/send
  timeouts. For the local direct-proxy setup this is not an issue.

**Acceptance check:** `up -d --build` completes; `http://localhost:3001` loads; clicking
login redirects to casdoor on :18000; `admin/123` authenticates and returns to the frontend
authenticated.

## Out of Scope

- The `gateway`, `proxy`, `worker`, `channel-worker`, and `wecom-bot-proxy` costrict-web
  binaries (only `server`/`cmd/api` is deployed; device tunnels/team WS that need them are
  not part of this local stack).
- APISIX / the costrict-deploy-docker reverse-proxy and router scripts (the local stack has
  no gateway; the browser talks to cloud-web directly).
- nacos, model services, chat-rag, credit-manager, oidc-auth, code-completion, prometheus,
  grafana — none are needed by the three deployed services.
- LLM / embedding keys (AI features degrade, server still boots).
- Production hardening (TLS, non-localhost binds, strong secrets) — this is a local dev stack.
