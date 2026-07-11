# CoStrict Cloud Local Docker Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the CoStrict Cloud frontend (app-ai-native), costrict-web Go backend, casdoor, and redis to multica's personal `docker-compose.local.yml`, building frontend + backend from local source and seeding casdoor for out-of-box `admin/123` login.

**Architecture:** Extend the existing local stack (postgres + multica backend/frontend + costrict-dept-sync). Add `cloud-web` (builds `../opencode`, host :3001), `cloud-api` (builds `../costrict-web/server`, internal :8080), `casdoor` (`zgsm/casdoor:v2.1.3`, host :18000), and `redis`. Share the existing postgres with two new databases (`costrict_db`, `casdoor`) created via initdb scripts; casdoor is seeded from costrict-deploy-docker's dump.

**Tech Stack:** Docker Compose v2, PostgreSQL 17 (pgvector image), Go 1.25 (costrict-web server), Bun + Vite + SolidJS (app-ai-native), casdoor v2.1.3, Redis 7.

**Spec:** `docs/superpowers/specs/2026-07-11-costrict-cloud-local-docker-stack-design.md`

---

## ⚠️ Important: these files are personal / gitignored

`docker-compose.local.yml` and everything under `docker/local-stack/` are **local-only, gitignored** files (the user keeps the full-stack compose out of version control). Therefore tasks in this plan do **not** `git commit` — each task ends with a verification step instead. The only artifact committed in this whole effort is the spec/plan docs themselves.

Working directory for all commands: `e:\Projects\multica` (the compose file's repo). Sibling repos `../costrict-web`, `../opencode`, `../costrict-deploy-docker`, `../costrict-dept-sync` must exist (they already do in this workspace).

**Validation command** used by most tasks (parses + resolves the compose file without building):
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```

---

## File Map

| File | Responsibility |
|---|---|
| `docker-compose.local.yml` (modify) | Add 4 services + postgres initdb mount + `redis_data` volume |
| `docker/local-stack/initdb/10-create-databases.sql` (create) | Create `costrict_db` and `casdoor` databases |
| `docker/local-stack/initdb/11-casdoor-seed.sql` (create = copy) | casdoor schema + seed data (from costrict-deploy-docker dump) |
| `docker/local-stack/initdb/12-casdoor-local-patch.sql` (create) | Set `app-built-in` redirect_uris to accept the costrict-web callback |
| `.gitignore` (modify) | Ignore `docker/local-stack/` |

---

### Task 1: Scaffold local-stack directory and gitignore

**Files:**
- Create: `docker/local-stack/initdb/.gitkeep`
- Modify: `.gitignore` (append one line)

- [ ] **Step 1: Create the initdb directory**

```bash
mkdir -p docker/local-stack/initdb
```

- [ ] **Step 2: Add a .gitkeep so the dir exists in tooling**

Write `docker/local-stack/initdb/.gitkeep` (empty file).

- [ ] **Step 3: Append the gitignore rule**

Add to the end of `.gitignore`:

```
# Local personal Docker Compose support files (initdb seeds, etc.)
docker/local-stack/
```

- [ ] **Step 4: Verify the dir is ignored**

Run:
```bash
git check-ignore docker/local-stack/initdb/.gitkeep
```
Expected output: `docker/local-stack/initdb/.gitkeep` (confirming it is ignored).

---

### Task 2: Postgres initdb scripts + mount

**Files:**
- Create: `docker/local-stack/initdb/10-create-databases.sql`
- Create: `docker/local-stack/initdb/11-casdoor-seed.sql`
- Create: `docker/local-stack/initdb/12-casdoor-local-patch.sql`
- Modify: `docker-compose.local.yml` (postgres service `volumes:`)

- [ ] **Step 1: Write `10-create-databases.sql`**

Content:
```sql
-- Create the databases used by costrict-web server and casdoor.
-- The multica database is created automatically by POSTGRES_DB.
CREATE DATABASE costrict_db;
CREATE DATABASE casdoor;
```

- [ ] **Step 2: Copy the casdoor seed dump from costrict-deploy-docker**

Run:
```bash
cp ../costrict-deploy-docker/config/postgres/initdb.d/11_casdoor_init.sql docker/local-stack/initdb/11-casdoor-seed.sql
```
This is the 1728-line Navicat dump. It begins with a comment block and contains `\c casdoor;` at line 18, so when run by postgres's initdb it switches into the `casdoor` database (created by `10-create-databases.sql`) before creating tables and inserting the `built-in` + `costrict_group` orgs, `app-built-in` + `costrict_login` apps, and the `admin` user.

- [ ] **Step 3: Verify the copied dump connects to the casdoor db**

Run:
```bash
sed -n '18p' docker/local-stack/initdb/11-casdoor-seed.sql
```
Expected output: `\c casdoor;`

- [ ] **Step 4: Write `12-casdoor-local-patch.sql`**

Content:
```sql
-- Point the built-in CoStrict application's redirect URIs at the costrict-web
-- OAuth callback so login works out of the box. casdoor matches each entry as
-- a regex; the seeded admin user (admin/123) lives in the built-in org that
-- owns app-built-in, so no user creation is needed.
\c casdoor;
UPDATE application SET redirect_uris = '[".*/api/auth/callback"]' WHERE name = 'app-built-in';
```

- [ ] **Step 5: Add the initdb mount to the postgres service**

In `docker-compose.local.yml`, the `postgres` service currently has:
```yaml
    volumes:
      - pgdata:/var/lib/postgresql/data
```
Change it to:
```yaml
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/local-stack/initdb:/docker-entrypoint-initdb.d:ro
```

- [ ] **Step 6: Verify compose still parses**

Run:
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```
Expected: `compose valid`

---

### Task 3: Add the redis service

**Files:**
- Modify: `docker-compose.local.yml` (add `redis` service + `redis_data` volume)

- [ ] **Step 1: Add the redis service**

In `docker-compose.local.yml`, insert this service block immediately before the top-level `volumes:` key (i.e. after the `frontend:` service):

```yaml
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
```

- [ ] **Step 2: Register the redis volume**

In the top-level `volumes:` block (currently `pgdata`, `backend_uploads`, `costrict_data`), add `redis_data:` so it reads:
```yaml
volumes:
  pgdata:
  backend_uploads:
  costrict_data:
  redis_data:
```

- [ ] **Step 3: Verify compose parses**

Run:
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```
Expected: `compose valid`

---

### Task 4: Add the casdoor service

**Files:**
- Modify: `docker-compose.local.yml` (add `casdoor` service)

- [ ] **Step 1: Add the casdoor service**

Insert this service block before the top-level `volumes:` key (alongside the others added above):

```yaml
  casdoor:
    image: zgsm/casdoor:v2.1.3
    restart: unless-stopped
    ports:
      - "127.0.0.1:18000:8000"
    environment:
      driverName: postgres
      dataSourceName: "host=postgres port=5432 user=${POSTGRES_USER:-multica} password=${POSTGRES_PASSWORD:-multica} dbname=casdoor sslmode=disable"
    depends_on:
      postgres:
        condition: service_healthy
```

- [ ] **Step 2: Verify compose parses**

Run:
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```
Expected: `compose valid`

---

### Task 5: Add the cloud-api service (costrict-web server)

**Files:**
- Modify: `docker-compose.local.yml` (add `cloud-api` service)

- [ ] **Step 1: Add the cloud-api service**

Insert this service block before the top-level `volumes:` key:

```yaml
  cloud-api:
    image: costrict-web-api:dev
    build:
      context: ../costrict-web/server
      dockerfile: Dockerfile
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      casdoor:
        condition: service_started
    environment:
      PORT: "8080"
      DATABASE_URL: postgres://${POSTGRES_USER:-multica}:${POSTGRES_PASSWORD:-multica}@postgres:5432/costrict_db?sslmode=disable
      REDIS_URL: redis://redis:6379
      COOKIE_SECURE: "false"
      CORS_ALLOWED_ORIGINS: http://localhost:3001
      COSTRICT_CLOUD_BASE_URL: http://localhost:3001
      FRONTEND_URLS: http://localhost:3001
      CASDOOR_ENDPOINT: http://localhost:18000
      CASDOOR_INTERNAL_ENDPOINT: http://casdoor:8000
      CASDOOR_CLIENT_ID: 8dd1828f0bc708f64365
      CASDOOR_CLIENT_SECRET: ab4af8f8748bce6756a3bc0c42ba41b716448fe7
      CASDOOR_ORGANIZATION: built-in
      CASDOOR_CALLBACK_URL: http://localhost:3001/api/auth/callback
      RUN_MIGRATIONS: "true"
    restart: unless-stopped
```

Notes for the executor:
- `COOKIE_SECURE=false` is mandatory because the local stack is plain HTTP.
- `CASDOOR_ENDPOINT` is browser-facing (host port); `CASDOOR_INTERNAL_ENDPOINT` is the in-compose address the server uses for token exchange / JWKS (`http://casdoor:8000/.well-known/jwks`).
- `RUN_MIGRATIONS=true` makes the bundled `migrate` binary create the `costrict_db` schema (incl. `pg_trgm`) on first boot.
- No host port is published; the frontend reaches the API over the compose network at `cloud-api:8080`.

- [ ] **Step 2: Verify compose parses**

Run:
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```
Expected: `compose valid`

---

### Task 6: Add the cloud-web service (app-ai-native frontend)

**Files:**
- Modify: `docker-compose.local.yml` (add `cloud-web` service)

- [ ] **Step 1: Add the cloud-web service**

Insert this service block before the top-level `volumes:` key:

```yaml
  cloud-web:
    image: costrict-web-portal:dev
    build:
      context: ../opencode
      dockerfile: packages/app-ai-native/Dockerfile
    depends_on:
      - cloud-api
    ports:
      - "127.0.0.1:3001:3000"
    environment:
      VITE_CLOUD_SERVER_HOST: cloud-api
      VITE_CLOUD_SERVER_PORT: "8080"
      VITE_API_PREFIX: ""
      VITE_APP_URL: http://localhost:3001
      VITE_CASDOOR_ENDPOINT: http://localhost:18000
      VITE_CASDOOR_CLIENT_ID: 8dd1828f0bc708f64365
      VITE_CASDOOR_ORG_NAME: built-in
      VITE_CASDOOR_APP_NAME: app-built-in
    restart: unless-stopped
```

Notes for the executor:
- Build context MUST be the opencode repo root (`../opencode`), not the package dir — the Dockerfile `COPY`s root `package.json`, `bun.lock`, `patches/`, and the sibling workspace packages.
- `VITE_API_PREFIX=""` means the bun server proxies `/api` and `/cloud` (incl. WebSocket) straight to `cloud-api:8080`.
- `VITE_CASDOOR_CLIENT_SECRET` is intentionally omitted — the secret stays server-side on cloud-api.
- Host port 3001 avoids colliding with the multica `frontend` service on host 3000.

- [ ] **Step 2: Verify compose parses**

Run:
```bash
docker compose -f docker-compose.local.yml config >/dev/null && echo "compose valid"
```
Expected: `compose valid`

- [ ] **Step 3: Sanity-check the resolved config for the new services**

Run:
```bash
docker compose -f docker-compose.local.yml config --services
```
Expected output (order may vary): includes `postgres costrict backend frontend redis casdoor cloud-api cloud-web`.

---

### Task 7: Bring the stack up and verify end-to-end

This is the integration test. First build of `cloud-api` (Go, via goproxy.cn) and `cloud-web` (bun install + vite build) is slow — several minutes. Subsequent runs use the build cache.

**Files:** none (runtime verification only).

- [ ] **Step 1: Start from a clean database volume**

The initdb scripts only run on a fresh `pgdata` volume. Wipe volumes first:
```bash
docker compose -f docker-compose.local.yml down -v
```
Expected: containers + volumes removed. (This wipes the multica DB too — acceptable for a local dev reset; the user has been told in the spec.)

- [ ] **Step 2: Build and start everything**

```bash
docker compose -f docker-compose.local.yml up -d --build
```
Expected: images build, containers start. Watch progress with:

> **Pre-existing port note:** the existing stack maps both `costrict` (dept-sync) and `backend` to host port `8080` (the backend uses `${PORT:-8080}`). If `PORT` is unset, those two collide and `up` fails with a port-in-use error — that is a pre-existing issue in the user's file, not introduced by this plan. If it happens, set `PORT` (e.g. `PORT=8082 docker compose -f docker-compose.local.yml up -d --build`) and proceed. None of the new services use host 8080.
```bash
docker compose -f docker-compose.local.yml logs -f --tail=50
```
(Slow on first run. Wait until cloud-api logs show migrations complete and the HTTP server listening on :8080, and cloud-web shows the bun server listening on :3000.)

- [ ] **Step 3: Confirm all services are up**

```bash
docker compose -f docker-compose.local.yml ps
```
Expected: `postgres`, `redis` healthy; `costrict`, `backend`, `frontend`, `casdoor`, `cloud-api`, `cloud-web` up. If `cloud-api` exited, inspect `docker compose logs cloud-api`.

- [ ] **Step 4: Confirm the new databases were created**

```bash
docker compose -f docker-compose.local.yml exec -T postgres psql -U "${POSTGRES_USER:-multica}" -lqt | cut -d'|' -f1 | grep -E 'costrict_db|casdoor|multica'
```
Expected: prints `casdoor`, `costrict_db`, `multica` (and possibly `postgres`, `template0`, `template1`).

- [ ] **Step 5: Confirm casdoor seed + patch loaded**

```bash
docker compose -f docker-compose.local.yml exec -T postgres psql -U "${POSTGRES_USER:-multica}" -d casdoor -c "SELECT name, redirect_uris FROM application WHERE name='app-built-in';"
```
Expected: one row, `name = app-built-in`, `redirect_uris = [".*/api/auth/callback"]`.

```bash
docker compose -f docker-compose.local.yml exec -T postgres psql -U "${POSTGRES_USER:-multica}" -d casdoor -c "SELECT name FROM organization;"
```
Expected: includes `built-in` and `costrict_group`.

- [ ] **Step 6: Confirm cloud-api migrated costrict_db**

```bash
docker compose -f docker-compose.local.yml exec -T postgres psql -U "${POSTGRES_USER:-multica}" -d costrict_db -c "\dt" | head -20
```
Expected: a list of tables (the server's GORM models + goose migrations), not empty.

- [ ] **Step 7: Confirm the frontends and casdoor respond**

```bash
curl -sI http://localhost:3001 | head -1
curl -sI http://localhost:18000 | head -1
```
Expected: `3001` → `HTTP/1.1 200 ...` (app-ai-native index); `18000` → 200 or 302 (casdoor).

- [ ] **Step 8: Confirm the OAuth redirect is wired**

```bash
curl -sI http://localhost:3001/api/auth/login | head -5
```
Expected: a `302` with a `Location` pointing at `http://localhost:18000/...` (casdoor authorize). If it 502s, cloud-api isn't ready or the bun proxy isn't reaching `cloud-api:8080` — recheck `cloud-api` logs and `VITE_CLOUD_SERVER_HOST`.

- [ ] **Step 9: Manual browser login round-trip (final acceptance)**

Open `http://localhost:3001` in a browser. Click login → redirected to casdoor on :18000 → log in as `admin` / `123` → redirected back to `http://localhost:3001/api/auth/callback` → then to the app, authenticated. If the cookie doesn't stick, confirm `COOKIE_SECURE=false` on cloud-api and that the bun proxy forwards `Set-Cookie`.

If casdoor rejects the callback with a redirect_uri error, re-check Task 2 Step 4 ran (the `12-casdoor-local-patch.sql` UPDATE) and that the `pgdata` volume was fresh in Step 1.

---

## Done criteria

All Task 7 steps pass. Specifically: the 8 services are up, `costrict_db` + `casdoor` databases exist, casdoor has `app-built-in` with the patched redirect URI, cloud-api has migrated `costrict_db`, `http://localhost:3001` loads, and the `admin/123` → casdoor → back-to-app login round-trip works in a browser.
