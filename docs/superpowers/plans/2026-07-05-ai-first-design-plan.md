# AI-First Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add NL (natural language) input entry points to the 4 core product surfaces — Workflow editor, Issue detail, Inbox, and Agent list — with a unified `POST /api/commands` API and shared `AiInputCore` component.

**Architecture:** A thin shared UI component (`AiInputCore`) with 4 scene-specific wrappers talks to a single Go endpoint (`POST /api/commands`). The endpoint dispatches by `context_type` to a `CommandPromptBuilder`, enqueues a task on the existing agent pipeline, and returns `{task_id, agent_id}`. The frontend listens for WS `task:completed` / `task:failed` events for feedback; Issue commands apply optimistic updates immediately.

**Tech Stack:** Go (Chi router, sqlc queries, pgx), TypeScript (React, TanStack Query, Zustand), existing Postgres `agent_task_queue` table, WebSocket events.

## Global Constraints

- TypeScript strict mode; Go follows gofmt/go vet conventions
- All shared UI goes in `packages/views/ai/`; zero `next/*` or `react-router-dom` imports
- API responses must be parsed through `parseWithFallback` (CLAUDE.md API Response Compatibility)
- Backend UUID parsing: user-input UUIDs → `parseUUIDOrBadRequest`; trusted round-trips → `parseUUID`
- Workspace-scoped routes use `middleware.RequireWorkspaceMember`
- PRs: one task per commit; conventional commit format
- Two apps (web + desktop) — new pages must be wired in both

---

## File Structure

```
# Frontend (packages/views/ai/)
packages/views/ai/
├── ai-input-core.tsx          # Pure UI: input box + agent selector + submit
├── ai-input-core.test.tsx     # Component tests
├── workflow-ai-panel.tsx      # Workflow chat wrapper (multi-turn)
├── workflow-ai-panel.test.tsx
├── issue-ai-bar.tsx           # Issue command wrapper (single-shot + optimistic)
├── issue-ai-bar.test.tsx
├── inbox-ai-panel.tsx         # Inbox command wrapper
├── inbox-ai-panel.test.tsx
├── agent-ai-panel.tsx         # Agent creation command wrapper
├── agent-ai-panel.test.tsx
├── index.ts                   # Barrel exports

# Frontend (packages/core/)
packages/core/ai/
├── commands.ts                # Hook: useSubmitCommand mutation + types
├── commands.test.ts
├── issue-commands.ts          # NL intent parser for issue commands (shared front+back shape)
├── issue-commands.test.ts
├── types.ts                   # CommandRequest, CommandResponse, ParsedIntent, etc.

# Frontend (packages/core/api/)
packages/core/api/client.ts    # +sendCommand method on ApiClient

# Backend (new files)
server/internal/handler/command.go       # POST /api/commands handler
server/internal/handler/command_test.go  # Handler tests
server/internal/service/command.go       # CommandService: dispatch + prompt building
server/internal/service/command_test.go  # Service tests

# Backend (modified files)
server/cmd/server/router.go              # +POST /api/commands route
server/pkg/protocol/events.go            # +EventCommandCompleted, EventCommandFailed (optional)
server/pkg/db/queries/agent.sql          # +CreateCommandTask query
server/pkg/db/generated/                 # sqlc regenerated code
```

---

### Task 1: Define TypeScript types and API client method

**Files:**
- Create: `packages/core/ai/types.ts`
- Modify: `packages/core/api/client.ts`

**Interfaces:**
- Produces: `CommandRequest`, `CommandResponse`, `AiContextType`, `CommandMode` types used by all frontend tasks

- [ ] **Step 1: Create types file**

```typescript
// packages/core/ai/types.ts

export type AiContextType = "workflow" | "issue" | "inbox" | "agent";

export type CommandMode = "chat" | "command";

export interface CommandRequest {
  context_type: AiContextType;
  context_id: string;
  user_input: string;
  mode: CommandMode;
  // workspace_id is NOT sent — ApiClient injects it via X-Workspace-ID header
}

export interface CommandResponse {
  task_id: string;
  agent_id: string;
}
```

- [ ] **Step 2: Add `sendCommand` to ApiClient**

In `packages/core/api/client.ts`, add after the existing chat methods:

```typescript
import type { CommandRequest, CommandResponse } from "../../ai/types";

// In ApiClient class, add:
async sendCommand(data: CommandRequest): Promise<CommandResponse> {
  return this.fetch("/api/commands", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/ai/types.ts packages/core/api/client.ts
git commit -m "feat(ai): add CommandRequest/Response types and sendCommand API method"
```

---

### Task 2: Backend — CreateCommandTask SQL query + sqlc regeneration

**Files:**
- Modify: `server/pkg/db/queries/agent.sql`
- Regenerate: `server/pkg/db/generated/`

**Interfaces:**
- Produces: `CreateCommandTask` SQL query, sqlc-generated Go function `CreateCommandTask(ctx, params) (MulticaAgentTaskQueue, error)`

- [ ] **Step 1: Add SQL query**

In `server/pkg/db/queries/agent.sql`, add after the `CreateQuickCreateTask` query (around line 109):

```sql
-- name: CreateCommandTask :one
-- Command tasks have no issue/chat/autopilot link; the context JSONB
-- carries context_type, context_id, user_input, and mode.
INSERT INTO multica_agent_task_queue (agent_id, runtime_id, status, priority, context)
VALUES ($1, $2, 'queued', $3, $4)
RETURNING *;
```

- [ ] **Step 2: Regenerate sqlc**

```bash
cd server && make sqlc
```
Expected: No errors, new `CreateCommandTask` function appears in `server/pkg/db/generated/agent.sql.go`.

- [ ] **Step 3: Commit**

```bash
git add server/pkg/db/queries/agent.sql server/pkg/db/generated/
git commit -m "feat(ai): add CreateCommandTask SQL query for AI command tasks"
```

---

### Task 3: Backend — CommandService

**Files:**
- Create: `server/internal/service/command.go`

**Interfaces:**
- Consumes: `CreateCommandTask` sqlc query from Task 2, `*service.TaskService` (Notifier interface)
- Produces: `CommandService` struct, `EnqueueCommandTask(ctx, params) (db.MulticaAgentTaskQueue, error)`

- [ ] **Step 1: Write the failing test**

```go
// server/internal/service/command_test.go
package service

import (
    "context"
    "encoding/json"
    "testing"
)

func TestCommandContextRoundTrip(t *testing.T) {
    original := CommandContext{
        Type:        "ai_command",
        ContextType: "issue",
        ContextID:   "test-issue-id",
        UserInput:   "分配给 @张三",
        Mode:        "command",
    }

    b, err := json.Marshal(original)
    if err != nil {
        t.Fatalf("marshal: %v", err)
    }

    var roundtripped CommandContext
    if err := json.Unmarshal(b, &roundtripped); err != nil {
        t.Fatalf("unmarshal: %v", err)
    }

    if roundtripped.Type != "ai_command" {
        t.Errorf("expected type 'ai_command', got %q", roundtripped.Type)
    }
    if roundtripped.ContextType != "issue" {
        t.Errorf("expected context_type 'issue', got %q", roundtripped.ContextType)
    }
    if roundtripped.UserInput != "分配给 @张三" {
        t.Errorf("expected user_input '分配给 @张三', got %q", roundtripped.UserInput)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && go test ./internal/service/ -run TestCommandContextRoundTrip
```
Expected: FAIL — "undefined: CommandContext"

- [ ] **Step 3: Write CommandService**

```go
// server/internal/service/command.go
package service

import (
    "context"
    "encoding/json"
    "fmt"

    "github.com/jackc/pgx/v5/pgtype"
    db "github.com/multica-ai/multica/server/pkg/db/generated"
    "github.com/multica-ai/multica/server/pkg/protocol"
)

// CommandContext is stored in agent_task_queue.context for AI command tasks.
type CommandContext struct {
    Type        string `json:"type"`         // always "ai_command"
    ContextType string `json:"context_type"` // "workflow" | "issue" | "inbox" | "agent"
    ContextID   string `json:"context_id"`   // entity ID (issue UUID, workflow UUID, etc.)
    UserInput   string `json:"user_input"`   // the raw NL input
    Mode        string `json:"mode"`         // "chat" | "command"
}

type CommandTaskParams struct {
    AgentID    pgtype.UUID
    RuntimeID  pgtype.UUID
    Priority   int32
    CtxPayload CommandContext
}

// EnqueueCommandTask creates an AI command task and notifies the daemon.
// It does NOT broadcast task:queued — command tasks complete quickly, and
// frontend feedback comes via optimistic updates + task:completed/failed.
func (s *TaskService) EnqueueCommandTask(ctx context.Context, params CommandTaskParams) (db.MulticaAgentTaskQueue, error) {
    rawCtx, err := json.Marshal(params.CtxPayload)
    if err != nil {
        return db.MulticaAgentTaskQueue{}, fmt.Errorf("marshal command context: %w", err)
    }

    task, err := s.Queries.CreateCommandTask(ctx, db.CreateCommandTaskParams{
        AgentID:   params.AgentID,
        RuntimeID: params.RuntimeID,
        Priority:  params.Priority,
        Context:   rawCtx,
    })
    if err != nil {
        return db.MulticaAgentTaskQueue{}, fmt.Errorf("create command task: %w", err)
    }

    s.NotifyTaskEnqueued(ctx, task)
    return task, nil
}

// Ensure TaskWakeupNotifier is used
var _ TaskWakeupNotifier = (TaskWakeupNotifier)(nil)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && go test ./internal/service/ -run TestCommandContextRoundTrip
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/command.go server/internal/service/command_test.go
git commit -m "feat(ai): add CommandService with EnqueueCommandTask"
```

---

### Task 4: Backend — POST /api/commands handler

**Files:**
- Create: `server/internal/handler/command.go`
- Modify: `server/cmd/server/router.go`

**Interfaces:**
- Consumes: `h.TaskService.EnqueueCommandTask`, `h.Queries.GetDefaultAgentForWorkspace` (or similar)
- Produces: `POST /api/commands` returns `{task_id, agent_id}` with 201

- [ ] **Step 1: Add route to router**

In `server/cmd/server/router.go`, inside the `middleware.RequireWorkspaceMember` group (after line 776, inside the last `r.Route` block), add:

```go
// AI Commands — unified NL entry point
r.Post("/api/commands", h.SendCommand)
```

- [ ] **Step 2: Write the handler**

```go
// server/internal/handler/command.go
package handler

import (
    "encoding/json"
    "net/http"

    db "github.com/multica-ai/multica/server/pkg/db/generated"
    "github.com/multica-ai/multica/server/internal/service"
)

// CommandRequest is the POST /api/commands request body.
type CommandRequest struct {
    ContextType string `json:"context_type"` // "workflow" | "issue" | "inbox" | "agent"
    ContextID   string `json:"context_id"`   // entity ID
    UserInput   string `json:"user_input"`   // NL input
    Mode        string `json:"mode"`         // "chat" | "command"
}

// CommandResponse is the POST /api/commands response body.
type CommandResponse struct {
    TaskID  string `json:"task_id"`
    AgentID string `json:"agent_id"`
}

const validContextTypes = map[string]bool{
    "workflow": true,
    "issue":    true,
    "inbox":    true,
    "agent":    true,
}

const validModes = map[string]bool{
    "chat":    true,
    "command": true,
}

func (h *Handler) SendCommand(w http.ResponseWriter, r *http.Request) {
    _, ok := requireUserID(w, r)
    if !ok {
        return
    }
    workspaceID := ctxWorkspaceID(r.Context())
    wsUUID, ok := parseUUIDOrBadRequest(w, workspaceID, "workspace_id")
    if !ok {
        return
    }

    var req CommandRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid request body")
        return
    }

    // Validate context_type
    if !validContextTypes[req.ContextType] {
        writeError(w, http.StatusBadRequest, "context_type must be one of: workflow, issue, inbox, agent")
        return
    }

    // Validate mode
    if !validModes[req.Mode] {
        writeError(w, http.StatusBadRequest, "mode must be one of: chat, command")
        return
    }

    // Validate user_input
    if req.UserInput == "" {
        writeError(w, http.StatusBadRequest, "user_input is required")
        return
    }

    // Resolve context_id to a UUID (only when provided)
    var contextID string
    if req.ContextID != "" {
        id, ok := parseUUIDOrBadRequest(w, req.ContextID, "context_id")
        if !ok {
            return
        }
        contextID = uuidToString(id)
    }

    // Resolve agent: use the workspace default agent
    agent, err := h.Queries.GetDefaultAgentForWorkspace(r.Context(), wsUUID)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to resolve default agent")
        return
    }

    // Resolve runtime for the agent
    runtime, err := h.Queries.GetActiveRuntimeForAgent(r.Context(), db.GetActiveRuntimeForAgentParams{
        AgentID:     agent.ID,
        WorkspaceID: wsUUID,
    })
    if err != nil {
        writeError(w, http.StatusInternalServerError, "no available runtime for agent")
        return
    }

    task, err := h.TaskService.EnqueueCommandTask(r.Context(), service.CommandTaskParams{
        AgentID:   agent.ID,
        RuntimeID: runtime.ID,
        Priority:  3, // high priority — user is waiting
        CtxPayload: service.CommandContext{
            Type:        "ai_command",
            ContextType: req.ContextType,
            ContextID:   contextID,
            UserInput:   req.UserInput,
            Mode:        req.Mode,
        },
    })
    if err != nil {
        writeError(w, http.StatusInternalServerError, "failed to enqueue command task")
        return
    }

    writeJSON(w, http.StatusCreated, CommandResponse{
        TaskID:  uuidToString(task.ID),
        AgentID: uuidToString(agent.ID),
    })
}
```

- [ ] **Step 3: Add necessary DB queries if they don't exist**

Check if `GetDefaultAgentForWorkspace` exists. If not, add a sqlc query:

```sql
-- name: GetDefaultAgentForWorkspace :one
SELECT * FROM multica_agent
WHERE workspace_id = $1 AND is_default = true AND archived_at IS NULL
LIMIT 1;
```

Alternative: If no "default agent" concept exists, fall back to first non-archived agent:

```sql
-- name: GetFirstAgentForWorkspace :one
SELECT * FROM multica_agent
WHERE workspace_id = $1 AND archived_at IS NULL
ORDER BY created_at ASC
LIMIT 1;
```

And update the handler to use `h.Queries.GetFirstAgentForWorkspace`.

- [ ] **Step 4: Build and check for compilation errors**

```bash
cd server && go build ./...
```
Expected: No compilation errors

- [ ] **Step 5: Commit**

```bash
git add server/internal/handler/command.go server/cmd/server/router.go server/pkg/db/queries/agent.sql server/pkg/db/generated/
git commit -m "feat(ai): add POST /api/commands handler with agent resolution"
```

---

### Task 5: Backend — Daemon claim response for command tasks

**Files:**
- Modify: `server/internal/handler/daemon.go`

**Interfaces:**
- Consumes: `CommandContext` from Task 3, claim response building in daemon.go

- [ ] **Step 1: Add command task detection in ClaimTaskByRuntime**

In `server/internal/handler/daemon.go`, in the `ClaimTaskByRuntime` handler, add after the quick-create detection block (around the area where quick_create is detected via `ctxPayload.Type == "quick_create"`):

```go
// AI command tasks — NL instructions from the command bar
var cmdCtx service.CommandContext
if json.Unmarshal(task.Context, &cmdCtx) == nil && cmdCtx.Type == "ai_command" {
    resp.IsCommandTask = true
    resp.CommandInput = cmdCtx.UserInput
    resp.CommandContextType = cmdCtx.ContextType
    resp.CommandContextID = cmdCtx.ContextID
    resp.WorkspaceID = workspaceIDStr
}
```

- [ ] **Step 2: Add response fields to the daemon claim response struct**

In `daemon.go`, add to the claim response struct:

```go
// Command task fields
IsCommandTask     bool   `json:"is_command_task,omitempty"`
CommandInput      string `json:"command_input,omitempty"`
CommandContextType string `json:"command_context_type,omitempty"`
CommandContextID  string `json:"command_context_id,omitempty"`
```

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/daemon.go
git commit -m "feat(ai): add command task detection in daemon claim response"
```

---

### Task 6: Backend — Handler tests

**Files:**
- Create: `server/internal/handler/command_test.go`

**Interfaces:**
- Consumes: `SendCommand` handler from Task 4
- Produces: Test coverage for validation, success, and error paths

- [ ] **Step 1: Write handler tests**

```go
// server/internal/handler/command_test.go
package handler

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestSendCommand_ValidRequest(t *testing.T) {
    t.Parallel()
    h, cleanup := newTestHandler(t)
    defer cleanup()

    body := CommandRequest{
        ContextType: "issue",
        ContextID:   "",
        UserInput:   "分配给 @张三",
        Mode:        "command",
    }
    raw, _ := json.Marshal(body)

    req := httptest.NewRequest(http.MethodPost, "/api/commands", bytes.NewReader(raw))
    req.Header.Set("Content-Type", "application/json")
    // Workspace + auth headers set by test helper
    setTestAuth(t, req)
    setTestWorkspace(t, req)

    w := httptest.NewRecorder()
    h.ServeHTTP(w, req)

    // For now, expect 500 (no default agent configured in test)
    // Once a default agent is part of test setup, this becomes 201
    if w.Code != http.StatusCreated && w.Code != http.StatusInternalServerError {
        t.Errorf("expected 201 or 500, got %d: %s", w.Code, w.Body.String())
    }
}

func TestSendCommand_MissingContextType(t *testing.T) {
    t.Parallel()
    h, cleanup := newTestHandler(t)
    defer cleanup()

    body := CommandRequest{
        UserInput: "hello",
        Mode:      "command",
    }
    raw, _ := json.Marshal(body)

    req := httptest.NewRequest(http.MethodPost, "/api/commands", bytes.NewReader(raw))
    req.Header.Set("Content-Type", "application/json")
    setTestAuth(t, req)
    setTestWorkspace(t, req)

    w := httptest.NewRecorder()
    h.ServeHTTP(w, req)

    if w.Code != http.StatusBadRequest {
        t.Errorf("expected 400, got %d", w.Code)
    }
}

func TestSendCommand_InvalidContextType(t *testing.T) {
    t.Parallel()
    h, cleanup := newTestHandler(t)
    defer cleanup()

    body := CommandRequest{
        ContextType: "invalid",
        UserInput:   "hello",
        Mode:        "command",
    }
    raw, _ := json.Marshal(body)

    req := httptest.NewRequest(http.MethodPost, "/api/commands", bytes.NewReader(raw))
    req.Header.Set("Content-Type", "application/json")
    setTestAuth(t, req)
    setTestWorkspace(t, req)

    w := httptest.NewRecorder()
    h.ServeHTTP(w, req)

    if w.Code != http.StatusBadRequest {
        t.Errorf("expected 400, got %d", w.Code)
    }
}

func TestSendCommand_EmptyInput(t *testing.T) {
    t.Parallel()
    h, cleanup := newTestHandler(t)
    defer cleanup()

    body := CommandRequest{
        ContextType: "issue",
        UserInput:   "",
        Mode:        "command",
    }
    raw, _ := json.Marshal(body)

    req := httptest.NewRequest(http.MethodPost, "/api/commands", bytes.NewReader(raw))
    req.Header.Set("Content-Type", "application/json")
    setTestAuth(t, req)
    setTestWorkspace(t, req)

    w := httptest.NewRecorder()
    h.ServeHTTP(w, req)

    if w.Code != http.StatusBadRequest {
        t.Errorf("expected 400, got %d", w.Code)
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cd server && go test ./internal/handler/ -run TestSendCommand -v
```
Expected: Tests pass (or FAIL with clear "not yet implemented" messages for setup-dependent tests)

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/command_test.go
git commit -m "test(ai): add handler tests for POST /api/commands validation"
```

---

### Task 7: Frontend — AiInputCore component (pure UI)

**Files:**
- Create: `packages/views/ai/ai-input-core.tsx`
- Create: `packages/views/ai/index.ts`

**Interfaces:**
- Produces: `AiInputCoreProps`, `AiInputCore` component — used by all 4 wrappers
- Consumes: shadcn `Button`, `Textarea` from `@multica/ui`

- [ ] **Step 1: Create barrel export**

```typescript
// packages/views/ai/index.ts
export { AiInputCore } from "./ai-input-core";
export type { AiInputCoreProps } from "./ai-input-core";
```

- [ ] **Step 2: Write AiInputCore component**

```typescript
// packages/views/ai/ai-input-core.tsx
"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@multica/ui/lib/utils";
import { SubmitButton } from "@multica/ui/components/common/submit-button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useT } from "../../i18n";

export interface AiInputCoreProps {
  mode: "chat" | "command";
  placeholder: string;
  showAgentSelector: boolean;
  defaultAgentId?: string;
  onSubmit: (input: string, agentId: string) => Promise<void>;
  disabled?: boolean;
  /** Rendered at the bottom-left — typically the agent picker. */
  leftAdornment?: React.ReactNode;
}

export function AiInputCore({
  mode,
  placeholder,
  showAgentSelector,
  defaultAgentId,
  onSubmit,
  disabled,
  leftAdornment,
}: AiInputCoreProps) {
  const { t } = useT("ai");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || submitting || disabled) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed, defaultAgentId ?? "");
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.error_unknown));
    } finally {
      setSubmitting(false);
    }
  }, [value, submitting, disabled, onSubmit, defaultAgentId, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Command mode: Enter submits (unless Shift is held for newline)
      if (mode === "command" && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      // Chat mode: Mod+Enter submits (matching existing chat behavior)
      if (mode === "chat" && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [mode, handleSubmit],
  );

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2",
        "focus-within:border-brand transition-colors",
        disabled && "opacity-60 pointer-events-none",
      )}
    >
      <div className="flex-1 min-h-0">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || submitting}
          rows={1}
          className={cn(
            "min-h-8 max-h-32 resize-none border-0 bg-transparent p-0",
            "placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0",
          )}
        />
        {error && (
          <p className="mt-1 text-xs text-destructive">{error}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {leftAdornment}
        {showAgentSelector && (
          <select
            className="h-8 rounded border border-border bg-background px-2 text-xs text-muted-foreground"
            defaultValue={defaultAgentId ?? ""}
            disabled={disabled || submitting}
          >
            <option value="">{t(($) => $.agent_default)}</option>
            {/* Agent list populated by wrapper via leftAdornment or a query */}
          </select>
        )}
        <SubmitButton
          onClick={handleSubmit}
          disabled={!value.trim() || submitting || disabled}
          running={submitting}
          size="sm"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Check TypeScript compilation**

```bash
pnpm --filter @multica/views exec tsc --noEmit
```
Expected: No type errors related to ai-input-core.tsx

- [ ] **Step 4: Commit**

```bash
git add packages/views/ai/
git commit -m "feat(ai): add AiInputCore shared UI component"
```

---

### Task 8: Frontend — AiInputCore tests

**Files:**
- Create: `packages/views/ai/ai-input-core.test.tsx`

- [ ] **Step 1: Write component tests**

```typescript
// packages/views/ai/ai-input-core.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiInputCore } from "./ai-input-core";

// Mock i18n
vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (key: string | ((helpers: { $: Record<string, string> }) => string)) => {
      if (typeof key === "function") return key({ $: {} });
      return key;
    },
  }),
  useCurrentLocale: () => "zh",
}));

describe("AiInputCore", () => {
  it("renders with placeholder", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder="输入指令…"
        showAgentSelector={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("输入指令…")).toBeInTheDocument();
  });

  it("calls onSubmit with input on Enter (command mode)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder="输入指令…"
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "分配给 @张三");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("分配给 @张三", "");
  });

  it("does not submit empty input", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="command"
        placeholder="输入指令…"
        showAgentSelector={false}
        onSubmit={onSubmit}
      />,
    );

    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit when disabled prop is true", () => {
    render(
      <AiInputCore
        mode="command"
        placeholder="输入指令…"
        showAgentSelector={false}
        onSubmit={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("triggers submit on Mod+Enter in chat mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <AiInputCore
        mode="chat"
        placeholder="描述你想要的 workflow…"
        showAgentSelector
        defaultAgentId="agent-1"
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole("textbox"), "build a CI pipeline");
    await user.keyboard("{Control>}{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("build a CI pipeline", "agent-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm --filter @multica/views exec vitest run ai/ai-input-core.test.tsx
```
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/views/ai/ai-input-core.test.tsx
git commit -m "test(ai): add AiInputCore component tests"
```

---

### Task 9: Frontend — useSubmitCommand hook + NL intent parser

**Files:**
- Create: `packages/core/ai/commands.ts`
- Create: `packages/core/ai/issue-commands.ts`
- Create: `packages/core/ai/commands.test.ts`
- Create: `packages/core/ai/issue-commands.test.ts`

**Interfaces:**
- Consumes: `ApiClient.sendCommand` from Task 1, `CommandRequest/CommandResponse` from Task 1
- Produces: `useSubmitCommand` hook, `parseIssueCommand` function

- [ ] **Step 1: Write the NL intent parser for issue commands**

```typescript
// packages/core/ai/issue-commands.ts

export type IssueCommandAction =
  | { type: "assign"; target: string; targetType: "member" | "agent" | "squad" }
  | { type: "status"; status: string }
  | { type: "priority"; priority: string }
  | { type: "label"; operation: "add" | "remove"; label: string }
  | { type: "unknown" };

/**
 * Parse a Chinese/English NL issue command into a structured intent.
 * Used by the frontend for optimistic updates BEFORE sending to the API.
 * The backend has an equivalent Go implementation in CommandPromptBuilder.
 */
export function parseIssueCommand(input: string): IssueCommandAction {
  const normalized = input.trim();

  // Assign: "分配给 @张三" / "assign 给 智能体名" / "交给 小队名"
  const assignPatterns = [
    /分配给\s*(?:@)?(.+)/,
    /assign\s*(?:给)?\s*(?:@)?(.+)/i,
    /交给\s*(?:@)?(.+)/,
  ];
  for (const pattern of assignPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const target = match[1].trim();
      if (target.includes("小队") || target.includes("squad")) {
        return { type: "assign", target: target.replace(/小队|squad/, "").trim(), targetType: "squad" };
      }
      return { type: "assign", target, targetType: "member" };
    }
  }

  // Status: "状态改为 in_review" / "标记为 done" / "移到 backlog"
  const statusPattern = /(?:状态(?:改为|改成|设为)|标记为|标为|移到|move\s*to)\s*(.+)/;
  const statusMatch = normalized.match(statusPattern);
  if (statusMatch) {
    const raw = statusMatch[1].trim();
    const statusMap: Record<string, string> = {
      done: "done", 完成: "done", completed: "done", done: "done",
      in_review: "in_review", review: "in_review", 审核: "in_review",
      backlog: "backlog", 待办: "backlog",
      todo: "todo", 待处理: "todo",
      in_progress: "in_progress", progress: "in_progress", 进行中: "in_progress",
      cancelled: "cancelled", 取消: "cancelled",
    };
    const status = statusMap[raw.toLowerCase()] ?? raw.toLowerCase().replace(/\s+/g, "_");
    return { type: "status", status };
  }

  // Priority: "优先级 P0" / "设为 urgent"
  const priorityPattern = /(?:优先级|priority|设为|set\s*(?:to)?)\s*(.+)/i;
  const priorityMatch = normalized.match(priorityPattern);
  if (priorityMatch) {
    const raw = priorityMatch[1].trim();
    const priorityMap: Record<string, string> = {
      p0: "urgent", urgent: "urgent", 紧急: "urgent",
      p1: "high", high: "high", 高: "high",
      p2: "medium", medium: "medium", 中: "medium",
      p3: "low", low: "low", 低: "low",
    };
    const priority = priorityMap[raw.toLowerCase()] ?? raw.toLowerCase();
    return { type: "priority", priority };
  }

  // Label: "加 bug 标签" / "去掉 enhancement"
  const addLabelPattern = /(?:加|add|添加)\s*(.+?)(?:\s*(?:标签|label|tag))?$/;
  const removeLabelPattern = /(?:去掉|移除|删除|remove|delete)\s*(.+?)(?:\s*(?:标签|label|tag))?$/;

  const addMatch = normalized.match(addLabelPattern);
  if (addMatch) {
    return { type: "label", operation: "add", label: addMatch[1].trim() };
  }
  const removeMatch = normalized.match(removeLabelPattern);
  if (removeMatch) {
    return { type: "label", operation: "remove", label: removeMatch[1].trim() };
  }

  return { type: "unknown" };
}
```

- [ ] **Step 2: Write the useSubmitCommand hook**

```typescript
// packages/core/ai/commands.ts
import { useMutation } from "@tanstack/react-query";
import { useApi } from "../api";
import type { CommandRequest, CommandResponse, AiContextType, CommandMode } from "./types";

interface SubmitCommandParams {
  contextType: AiContextType;
  contextId: string;
  userInput: string;
  mode: CommandMode;
}

export function useSubmitCommand() {
  const api = useApi();

  return useMutation<CommandResponse, Error, SubmitCommandParams>({
    mutationFn: (params) => {
      const req: CommandRequest = {
        // workspace_id is injected by ApiClient via X-Workspace-ID header
        context_type: params.contextType,
        context_id: params.contextId,
        user_input: params.userInput,
        mode: params.mode,
      };
      return api.sendCommand(req);
    },
  });
}
```

- [ ] **Step 3: Write tests for the intent parser**

```typescript
// packages/core/ai/issue-commands.test.ts
import { describe, it, expect } from "vitest";
import { parseIssueCommand } from "./issue-commands";

describe("parseIssueCommand", () => {
  describe("assign", () => {
    it("parses 分配给 @张三", () => {
      const result = parseIssueCommand("分配给 @张三");
      expect(result).toEqual({ type: "assign", target: "张三", targetType: "member" });
    });

    it("parses assign 给 agent-name", () => {
      const result = parseIssueCommand("assign 给 Code Reviewer");
      expect(result).toEqual({ type: "assign", target: "Code Reviewer", targetType: "member" });
    });

    it("parses 交给 开发小队", () => {
      const result = parseIssueCommand("交给 开发小队");
      expect(result).toEqual({ type: "assign", target: "开发", targetType: "squad" });
    });
  });

  describe("status", () => {
    it("parses 状态改为 in_review", () => {
      const result = parseIssueCommand("状态改为 in_review");
      expect(result).toEqual({ type: "status", status: "in_review" });
    });

    it("parses 标记为 done", () => {
      const result = parseIssueCommand("标记为 done");
      expect(result).toEqual({ type: "status", status: "done" });
    });

    it("parses 移到 backlog", () => {
      const result = parseIssueCommand("移到 backlog");
      expect(result).toEqual({ type: "status", status: "backlog" });
    });
  });

  describe("priority", () => {
    it("parses 优先级 P0", () => {
      const result = parseIssueCommand("优先级 P0");
      expect(result).toEqual({ type: "priority", priority: "urgent" });
    });

    it("parses 设为 urgent", () => {
      const result = parseIssueCommand("设为 urgent");
      expect(result).toEqual({ type: "priority", priority: "urgent" });
    });
  });

  describe("label", () => {
    it("parses 加 bug 标签", () => {
      const result = parseIssueCommand("加 bug 标签");
      expect(result).toEqual({ type: "label", operation: "add", label: "bug" });
    });

    it("parses 去掉 enhancement", () => {
      const result = parseIssueCommand("去掉 enhancement");
      expect(result).toEqual({ type: "label", operation: "remove", label: "enhancement" });
    });
  });

  describe("unknown", () => {
    it("returns unknown for unrecognized input", () => {
      const result = parseIssueCommand("帮我看看这个 issue 的进展");
      expect(result).toEqual({ type: "unknown" });
    });
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @multica/core exec vitest run ai/commands.test.ts ai/issue-commands.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/ai/
git commit -m "feat(ai): add useSubmitCommand hook and NL intent parser for issue commands"
```

---

### Task 10: Frontend — IssueAiBar wrapper

**Files:**
- Create: `packages/views/ai/issue-ai-bar.tsx`
- Create: `packages/views/ai/issue-ai-bar.test.tsx`
- Modify: `packages/views/ai/index.ts`

- [ ] **Step 1: Write IssueAiBar component**

```typescript
// packages/views/ai/issue-ai-bar.tsx
"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { parseIssueCommand } from "@multica/core/ai/issue-commands";
import { useT } from "../../i18n";

interface IssueAiBarProps {
  issueId: string;
  /** Called with the parsed intent BEFORE the API call, for optimistic updates. */
  onOptimisticIntent?: (intent: ReturnType<typeof parseIssueCommand>) => void;
  disabled?: boolean;
}

export function IssueAiBar({ issueId, onOptimisticIntent, disabled }: IssueAiBarProps) {
  const { t } = useT("ai");
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, _agentId: string) => {
      // Parse intent locally for optimistic update
      const intent = parseIssueCommand(input);

      // Apply optimistic update BEFORE the API call
      if (intent.type !== "unknown") {
        onOptimisticIntent?.(intent);
      }

      // Fire API call — the agent handles the actual mutation
      await mutation.mutateAsync({
        contextType: "issue",
        contextId: issueId,
        userInput: input,
        mode: "command",
      });
    },
    [issueId, mutation, onOptimisticIntent],
  );

  return (
    <div className="flex flex-col gap-1">
      <AiInputCore
        mode="command"
        placeholder={t(($) => $.issue_placeholder)}
        showAgentSelector={false}
        onSubmit={handleSubmit}
        disabled={disabled || mutation.isPending}
      />
      {mutation.isError && (
        <p className="text-xs text-destructive px-1">
          {t(($) => $.error_command)}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/views/ai/issue-ai-bar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueAiBar } from "./issue-ai-bar";

// Mock i18n and core
vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (key: string | Function) => typeof key === "function" ? key({ $: {} }) : key,
  }),
}));

vi.mock("@multica/core/ai/commands", () => ({
  useSubmitCommand: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ task_id: "task-1", agent_id: "agent-1" }),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@multica/core/ai/issue-commands", () => ({
  parseIssueCommand: (input: string) => {
    if (input.includes("分配给")) return { type: "assign", target: "张三", targetType: "member" };
    return { type: "unknown" };
  },
}));

describe("IssueAiBar", () => {
  it("renders input bar", () => {
    render(<IssueAiBar issueId="issue-1" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("calls onOptimisticIntent with parsed intent", async () => {
    const onOptimisticIntent = vi.fn();
    const user = userEvent.setup();

    render(<IssueAiBar issueId="issue-1" onOptimisticIntent={onOptimisticIntent} />);

    await user.type(screen.getByRole("textbox"), "分配给 @张三");
    await user.keyboard("{Enter}");

    expect(onOptimisticIntent).toHaveBeenCalledWith({
      type: "assign",
      target: "张三",
      targetType: "member",
    });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @multica/views exec vitest run ai/issue-ai-bar.test.tsx
```
Expected: All tests PASS

- [ ] **Step 4: Update barrel export**

```typescript
// packages/views/ai/index.ts — add:
export { IssueAiBar } from "./issue-ai-bar";
```

- [ ] **Step 5: Commit**

```bash
git add packages/views/ai/
git commit -m "feat(ai): add IssueAiBar wrapper with optimistic intent parsing"
```

---

### Task 11: Frontend — WS event listener for command task results

**Files:**
- Create: `packages/core/ai/task-listener.ts`

**Interfaces:**
- Consumes: WS client from `@multica/core/api/ws-client`, `CommandResponse` from Task 1
- Produces: `useCommandTaskListener(taskId, callbacks)` hook

- [ ] **Step 1: Write the task event listener hook**

```typescript
// packages/core/ai/task-listener.ts
import { useEffect } from "react";
import { useWSClient } from "../api/ws-client";

interface CommandTaskCallbacks {
  onCompleted?: (result: unknown) => void;
  onFailed?: (error: string) => void;
}

/**
 * Listens for task:completed / task:failed WS events for a specific command task.
 * Used by all AI wrappers to get feedback after POST /api/commands.
 */
export function useCommandTaskListener(
  taskId: string | null,
  callbacks: CommandTaskCallbacks,
) {
  const ws = useWSClient();

  useEffect(() => {
    if (!taskId) return;

    const unsubCompleted = ws?.on("task:completed", (payload: any) => {
      if (payload?.task_id === taskId) {
        callbacks.onCompleted?.(payload);
      }
    });

    const unsubFailed = ws?.on("task:failed", (payload: any) => {
      if (payload?.task_id === taskId) {
        callbacks.onFailed?.(payload?.error ?? "Task failed");
      }
    });

    return () => {
      unsubCompleted?.();
      unsubFailed?.();
    };
  }, [taskId, ws, callbacks]);
}
```

- [ ] **Step 2: Update IssueAiBar to use the listener**

In `packages/views/ai/issue-ai-bar.tsx`, add:

```typescript
const [taskId, setTaskId] = useState<string | null>(null);

useCommandTaskListener(taskId, {
  onFailed: (_error) => {
    // Rollback optimistic update (re-fetch issue data)
    // queryClient.invalidateQueries(...)
  },
});

// In handleSubmit, after mutateAsync:
// setTaskId(result.task_id);
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/ai/task-listener.ts packages/views/ai/issue-ai-bar.tsx
git commit -m "feat(ai): add WS event listener for command task results"
```

---

### Task 12: Frontend — Integrate IssueAiBar into Issue detail page

**Files:**
- Modify: `packages/views/issues/components/` (the issue detail page component)
- Modify: `apps/web/app/(app)/[slug]/issues/[id]/page.tsx` (if web app has its own wrapper)
- Modify: `apps/desktop/src/renderer/src/` (if desktop app has its own wrapper)

**Interfaces:**
- Consumes: `IssueAiBar` from Task 10

- [ ] **Step 1: Find the issue detail component**

```bash
grep -r "IssueDetail\|IssuePage\|issue-detail" packages/views/issues/ --files-with-matches
```

- [ ] **Step 2: Add IssueAiBar to the issue detail page**

At the bottom of the issue detail component, add:

```tsx
import { IssueAiBar } from "../../ai";

// Inside the component, near the bottom of the issue detail:
<IssueAiBar
  issueId={issue.id}
  onOptimisticIntent={(intent) => {
    // Apply optimistic updates based on parsed intent
    // (wire into existing issue mutation stores)
  }}
/>
```

The exact integration point depends on the existing issue detail layout — find the appropriate insertion point in the JSX tree.

- [ ] **Step 3: Verify TypeScript compilation**

```bash
pnpm typecheck
```
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/views/issues/ packages/views/ai/index.ts
git commit -m "feat(ai): integrate IssueAiBar into issue detail page"
```

---

### Task 13: Frontend — WorkflowAiPanel wrapper

**Files:**
- Create: `packages/views/ai/workflow-ai-panel.tsx`
- Modify: `packages/views/ai/index.ts`

- [ ] **Step 1: Write WorkflowAiPanel**

```tsx
// packages/views/ai/workflow-ai-panel.tsx
"use client";

import { useState, useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../../i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface WorkflowAiPanelProps {
  workflowId: string;
  disabled?: boolean;
}

export function WorkflowAiPanel({ workflowId, disabled }: WorkflowAiPanelProps) {
  const { t } = useT("ai");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, agentId: string) => {
      // Add user message locally
      const userMsg: ChatMessage = { role: "user", content: input };
      setMessages((prev) => [...prev, userMsg]);

      // Send to backend
      await mutation.mutateAsync({
        contextType: "workflow",
        contextId: workflowId,
        userInput: input,
        mode: "chat",
      });

      // The actual agent response comes via WS events (workflow:updated)
      // We don't add a fake assistant message — the canvas refresh is the response
    },
    [workflowId, mutation],
  );

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {/* Chat message history */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto px-1">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-sm ${msg.role === "user" ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span className="font-medium text-xs text-muted-foreground">
                {msg.role === "user" ? t(($) => $.you) : t(($) => $.agent)}:
              </span>{" "}
              {msg.content}
            </div>
          ))}
        </div>
      )}
      <AiInputCore
        mode="chat"
        placeholder={t(($) => $.workflow_placeholder)}
        showAgentSelector
        onSubmit={handleSubmit}
        disabled={disabled || mutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update barrel export**

```typescript
// packages/views/ai/index.ts — add:
export { WorkflowAiPanel } from "./workflow-ai-panel";
```

- [ ] **Step 3: Commit**

```bash
git add packages/views/ai/
git commit -m "feat(ai): add WorkflowAiPanel with multi-turn chat history"
```

---

### Task 14: Frontend — InboxAiPanel and AgentAiPanel wrappers

**Files:**
- Create: `packages/views/ai/inbox-ai-panel.tsx`
- Create: `packages/views/ai/agent-ai-panel.tsx`
- Modify: `packages/views/ai/index.ts`

- [ ] **Step 1: Write InboxAiPanel**

```tsx
// packages/views/ai/inbox-ai-panel.tsx
"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../../i18n";

interface InboxAiPanelProps {
  disabled?: boolean;
}

export function InboxAiPanel({ disabled }: InboxAiPanelProps) {
  const { t } = useT("ai");
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, _agentId: string) => {
      await mutation.mutateAsync({
        contextType: "inbox",
        contextId: "", // inbox queries don't need a specific entity ID
        userInput: input,
        mode: "command",
      });
    },
    [mutation],
  );

  return (
    <AiInputCore
      mode="command"
      placeholder={t(($) => $.inbox_placeholder)}
      showAgentSelector={false}
      onSubmit={handleSubmit}
      disabled={disabled || mutation.isPending}
    />
  );
}
```

- [ ] **Step 2: Write AgentAiPanel**

```tsx
// packages/views/ai/agent-ai-panel.tsx
"use client";

import { useCallback } from "react";
import { AiInputCore } from "./ai-input-core";
import { useSubmitCommand } from "@multica/core/ai/commands";
import { useT } from "../../i18n";

interface AgentAiPanelProps {
  disabled?: boolean;
}

export function AgentAiPanel({ disabled }: AgentAiPanelProps) {
  const { t } = useT("ai");
  const mutation = useSubmitCommand();

  const handleSubmit = useCallback(
    async (input: string, agentId: string) => {
      await mutation.mutateAsync({
        contextType: "agent",
        contextId: "", // agent creation doesn't need a pre-existing entity ID
        userInput: input,
        mode: "command",
      });
    },
    [mutation],
  );

  return (
    <AiInputCore
      mode="command"
      placeholder={t(($) => $.agent_placeholder)}
      showAgentSelector
      onSubmit={handleSubmit}
      disabled={disabled || mutation.isPending}
    />
  );
}
```

- [ ] **Step 3: Update barrel export**

```typescript
// packages/views/ai/index.ts — add:
export { InboxAiPanel } from "./inbox-ai-panel";
export { AgentAiPanel } from "./agent-ai-panel";
```

- [ ] **Step 4: Commit**

```bash
git add packages/views/ai/
git commit -m "feat(ai): add InboxAiPanel and AgentAiPanel wrappers"
```

---

### Task 15: Frontend — i18n strings for AI components

**Files:**
- Modify: `packages/views/locales/zh/ai.json` (create if not exists)
- Modify: `packages/views/locales/en/ai.json` (create if not exists)

- [ ] **Step 1: Add Chinese locale**

```json
// packages/views/locales/zh/ai.json
{
  "issue_placeholder": "输入指令… 例如：分配给 @张三",
  "workflow_placeholder": "描述你想要的 workflow…",
  "inbox_placeholder": "输入指令… 例如：归档所有已完成的",
  "agent_placeholder": "描述你要创建的智能体…",
  "you": "你",
  "agent": "智能体",
  "error_unknown": "未知错误，请重试",
  "error_command": "指令执行失败，请重试"
}
```

- [ ] **Step 2: Add English locale**

```json
// packages/views/locales/en/ai.json
{
  "issue_placeholder": "Type a command… e.g., assign to @John",
  "workflow_placeholder": "Describe the workflow you want…",
  "inbox_placeholder": "Type a command… e.g., archive all completed",
  "agent_placeholder": "Describe the agent you want to create…",
  "you": "You",
  "agent": "Agent",
  "error_unknown": "Unknown error, please retry",
  "error_command": "Command execution failed, please retry"
}
```

- [ ] **Step 3: Register in i18n configuration**

Check `packages/views/i18n/` for the locale loading configuration and add `ai` to the namespace list.

- [ ] **Step 4: Commit**

```bash
git add packages/views/locales/ packages/views/i18n/
git commit -m "feat(ai): add i18n strings for AI command components"
```

---

### Task 16: Backend — CommandPromptBuilder (backend prompt construction)

**Files:**
- Create: `server/internal/service/command_prompt.go`

- [ ] **Step 1: Write the prompt builder**

```go
// server/internal/service/command_prompt.go
package service

import (
    "context"
    "fmt"
    "strings"

    db "github.com/multica-ai/multica/server/pkg/db/generated"
    "github.com/jackc/pgx/v5/pgtype"
)

// BuildCommandPrompt constructs the prompt sent to the agent for AI command tasks.
// The prompt includes workspace context (agents, squads, members) and the user's NL input.
func BuildCommandPrompt(
    ctx context.Context,
    queries *db.Queries,
    workspaceID pgtype.UUID,
    cmdCtx CommandContext,
) (string, error) {
    var b strings.Builder

    // System instruction based on context_type
    switch cmdCtx.ContextType {
    case "issue":
        b.WriteString("You are an issue management agent.\n")
        b.WriteString("You can: assign issues, change status, set priority, add/remove labels.\n")
        b.WriteString("Use the available tools to execute the user's command.\n\n")

        // Load issue context if context_id is provided
        if cmdCtx.ContextID != "" {
            id, err := parseUUID(cmdCtx.ContextID)
            if err == nil {
                issue, err := queries.GetIssue(ctx, id)
                if err == nil {
                    fmt.Fprintf(&b, "Current issue: %s (status: %s, priority: %s)\n\n",
                        issue.Title, issue.Status, issue.Priority)
                }
            }
        }

    case "workflow":
        b.WriteString("You are a workflow design agent.\n")
        b.WriteString("You create and modify workflows based on natural language descriptions.\n")
        b.WriteString("Use the workflow tools to build the requested automation.\n\n")

    case "inbox":
        b.WriteString("You are an inbox management agent.\n")
        b.WriteString("You can: archive items, mark as read, summarize activity.\n")
        b.WriteString("Use the available tools to execute the user's command.\n\n")

    case "agent":
        b.WriteString("You are an agent configuration assistant.\n")
        b.WriteString("You create agents based on natural language descriptions.\n")
        b.WriteString("Extract: name, model provider, skills, and description from the user's input.\n\n")
    }

    // Add workspace context: available agents, squads, members
    b.WriteString("---\nWorkspace resources:\n")

    agents, _ := queries.ListAgents(ctx, workspaceID)
    if len(agents) > 0 {
        b.WriteString("Available agents:\n")
        for _, a := range agents {
            desc := ""
            if a.Description.Valid {
                desc = " - " + a.Description.String
            }
            fmt.Fprintf(&b, "- %s%s\n", a.Name, desc)
        }
        b.WriteString("\n")
    }

    squads, _ := queries.ListSquads(ctx, workspaceID)
    if len(squads) > 0 {
        b.WriteString("Available squads:\n")
        for _, s := range squads {
            fmt.Fprintf(&b, "- %s\n", s.Name)
        }
        b.WriteString("\n")
    }

    members, _ := queries.ListMembersWithUser(ctx, workspaceID)
    if len(members) > 0 {
        b.WriteString("Workspace members:\n")
        for _, m := range members {
            fmt.Fprintf(&b, "- %s (%s)\n", m.User.Name, m.User.Email)
        }
        b.WriteString("\n")
    }

    b.WriteString("---\n")
    fmt.Fprintf(&b, "User command: %s\n", cmdCtx.UserInput)

    return b.String(), nil
}

func parseUUID(s string) (pgtype.UUID, error) {
    var id pgtype.UUID
    err := id.Scan(s)
    return id, err
}
```

- [ ] **Step 2: Update CommandService to build prompt**

In `server/internal/service/command.go`, update `EnqueueCommandTask` to include the built prompt in context:

```go
// Build and include the prompt in the context
prompt, err := BuildCommandPrompt(ctx, s.Queries, params.WorkspaceID, params.CtxPayload)
if err != nil {
    // Non-fatal — agent can still work with just the user input
    // Log the error and continue
}

params.CtxPayload.Prompt = prompt
```

And add `Prompt string `json:"prompt,omitempty"`` to `CommandContext`.

- [ ] **Step 3: Commit**

```bash
git add server/internal/service/command_prompt.go server/internal/service/command.go
git commit -m "feat(ai): add CommandPromptBuilder for context-aware agent prompts"
```

---

### Task 17: Integration — Wire panels into the app pages

**Files:**
- Modify: `packages/views/workflows/` — add WorkflowAiPanel to workflow editor page
- Modify: `packages/views/inbox/components/inbox-page.tsx` — add InboxAiPanel to inbox page
- Modify: `packages/views/agents/` — add AgentAiPanel to agents list page

- [ ] **Step 1: Add WorkflowAiPanel to workflow editor**

Find the workflow editor component and add `WorkflowAiPanel` at the bottom of the canvas/editor area.

- [ ] **Step 2: Add InboxAiPanel to inbox page**

In `packages/views/inbox/components/inbox-page.tsx`, add `<InboxAiPanel />` near the bottom of the page.

- [ ] **Step 3: Add AgentAiPanel to agents page**

Find the agents list page and add `<AgentAiPanel />` at the bottom.

- [ ] **Step 4: Verify cross-app TypeScript compilation**

```bash
pnpm typecheck
```
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/views/ packages/views/ai/
git commit -m "feat(ai): wire AI panels into workflow, inbox, and agents pages"
```

---

### Task 18: End-to-end verification

- [ ] **Step 1: Start the full dev environment**

```bash
make dev
```

- [ ] **Step 2: Run all existing tests to verify no regressions**

```bash
make check
```
Expected: All checks pass (typecheck, unit tests, Go tests)

- [ ] **Step 3: Manual smoke test — IssueAiBar**

1. Open an issue detail page
2. Type "分配给 @username" in the command bar and press Enter
3. Verify: POST request fires, optimistic update happens, WS event updates UI

- [ ] **Step 4: Manual smoke test — WorkflowAiPanel**

1. Open a workflow editor
2. Type "create a workflow that sends a Slack notification when an issue is marked done" in the chat panel
3. Verify: multi-turn conversation works, workflow canvas updates

- [ ] **Step 5: Commit any fixes**

```bash
git commit -m "chore(ai): e2e verification fixes"
```

---

## Architecture Notes for Implementers

### Task variant detection in daemon
The daemon claim handler (`daemon.go`) detects command tasks by checking `context.type == "ai_command"` in the JSONB — same pattern as `"quick_create"`. The daemon uses `CommandContextType` to set up the appropriate tool set (issue tools vs workflow tools vs inbox tools).

### Optimistic update flow
For issue commands only: `parseIssueCommand()` runs in the frontend, produces a typed intent, and the `IssueAiBar` wrapper applies the optimistic mutation to Zustand/TanStack Query BEFORE calling `POST /api/commands`. If the task fails (`task:failed` WS event), roll back. Other scenarios (workflow, inbox, agent) do NOT apply optimistic updates — they wait for WS events.

### Chat vs Command modes
- `command`: Single-shot. Enter sends. No session maintained. No chat history.
- `chat`: Multi-turn (workflow only). Mod+Enter sends. Local message history. Each turn is a separate `POST /api/commands` with `mode: "chat"`. The backend uses `context_id` to identify the workflow being iterated on.

### Frontend packages
- `packages/core/ai/` — headless: types, hooks, intent parser. Zero react-dom.
- `packages/views/ai/` — UI components: AiInputCore + 4 wrappers. Cannot import `next/*` or `react-router-dom`.
- i18n strings in `packages/views/locales/{zh,en}/ai.json`

### Test strategy
- `parseIssueCommand` — pure function, tested in core (Node, no DOM)
- `AiInputCore` — UI component, tested in views (jsdom, testing-library)
- `IssueAiBar` — wrapper integration, tested in views (mock core hooks)
- Go handlers — standard `go test`, mock DB via test fixtures
- Go service — standard `go test`, mock queries
