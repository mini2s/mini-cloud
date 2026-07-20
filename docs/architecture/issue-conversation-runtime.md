# Issue conversation runtime

## Scope

The issue detail view resolves one existing conversation and renders it through
assistant-ui. It does not own a thread list and cannot create, archive, fork, or
rename arbitrary conversations.

Multica and `@assistant-ui/react-opencode` talk to the same cs-cloud proxy
surface. The Multica-specific step is bootstrap:

```text
workspace ID + issue ID
  -> GET /api/workspaces/:workspaceID/issues/:issueID/session
  -> conversation ID + workspace directory + proxy base URL
  -> cloud proxy client
  -> conversation runtime controller
  -> assistant-ui ExternalStoreRuntime
```

The issue session request is enabled only after the user opens the realtime
session tab. The response's `conversation_id` is the runtime identity;
`originNodeRun.session_id` remains relevant to the existing workflow takeover
permission but is not used to route proxy events.

## Protocol evidence

The implementation follows these local sources:

- `docs/api/issue-conversation-session.md`
- `assistant-ui/packages/react-opencode/src/useOpenCodeRuntime.ts`
- `assistant-ui/packages/react-opencode/src/OpenCodeEventSource.ts`
- `assistant-ui/packages/react-opencode/src/OpenCodeThreadController.ts`
- `assistant-ui/packages/react-opencode/src/openCodeThreadState.ts`
- `assistant-ui/packages/react-opencode/src/openCodeMessageProjection.ts`
- `assistant-ui/packages/react-opencode/src/pathRewriter.ts`
- `opencode/packages/app-ai-native/src/client/device-client.ts`
- `opencode/packages/app-ai-native/docs/assistant-ui-react-sse-runtime-research.md`

The relevant REST mapping is:

| Operation | Proxy request |
| --- | --- |
| conversation | `GET /api/v1/conversations/:id` |
| messages | `GET /api/v1/conversations/:id/messages` |
| status | `GET /api/v1/conversations/status` |
| send | `POST /api/v1/conversations/:id/prompt/async` |
| abort | `POST /api/v1/conversations/:id/abort` |
| todo | `GET /api/v1/conversations/:id/todo` |
| tasks | `GET /api/v1/conversations/:id/tasks` |
| diff | `GET /api/v1/conversations/:id/diff` |
| permissions | `GET /api/v1/permissions` and `POST /api/v1/permissions/:id/reply` |
| questions | `GET /api/v1/questions`, reply, and reject |
| events | `GET /api/v1/events` |

Every proxy request carries
`X-Workspace-Directory: encodeURIComponent(workspaceDirectory)`. Requests use
the Multica `ApiClient` raw authenticated transport, preserving bearer/cookie
authentication, request identity headers, and the shared 401 path.

The SDK used by the researched app and the package consumed by
`react-opencode` are not version-aligned in this workspace. The public
`react-opencode` runtime also owns a multi-thread registry and its own external
store. Consequently this implementation uses the same proxy contract through a
narrow client instead of importing the complete runtime or pretending to
implement a full `OpencodeClient`. If Multica later adopts the same generated
SDK as cs-cloud, `clients/cloud-proxy` is the replacement boundary.

## Directory responsibilities

```text
packages/core/conversations/
  sources/issue/
    issue -> proxy descriptor

  clients/cloud-proxy/
    REST transport, canonical SSE decoding, and workspace-level shared stream

  runtime/
    conversation state, reducer, Query integration, and controller

packages/views/common/session/runtime/
  assistant-ui message projection and ExternalStoreRuntime provider

packages/views/issues/components/issue-conversation-panel.tsx
  on-demand issue bootstrap and issue-specific error/loading UI
```

`Conversation` names backend resources. Existing `Session` and `SessionThread`
names remain unchanged because they describe the live UI surface.

## State and synchronization

The issue descriptor and canonical session state live in TanStack Query.
Zustand and component-local message arrays are not used for server state.

Initialization subscribes to the shared workspace event stream first, buffers
events for the target conversation, loads the REST snapshot, then replays the
buffer. A stream is shared by proxy base URL and workspace directory. Each
controller filters normalized events by `sessionID === conversationId`.

The stream accepts both `{ directory, payload }` and raw `{ type, properties }`
wire envelopes. Session routing is normalized from:

- `properties.sessionID`
- `properties.part.sessionID`
- `properties.info.sessionID`
- `properties.info.id` for session lifecycle events

Reconnects, `session.compacted`, and deltas without a base message/part force a
REST snapshot refresh. The stream has no reliable cursor, so REST remains the
final consistency source.

The reducer preserves existing message creation metadata, matches tool parts by
part ID with a `callID` fallback, retains tool output omitted by later updates,
and supports text/reasoning plus tool-input deltas. A REST message snapshot is
final truth for message and part membership: parts absent from the latest
snapshot are removed instead of being retained from prior in-memory state.
Unknown extension events are bounded diagnostics and never terminate the
stream.

The initial snapshot requests 200 messages, matching
`MESSAGE_INITIAL_LIMIT` in app-ai-native. The issue detail does not currently
offer incremental history loading.

`session.error` is normalized into canonical state from either
`properties.error` or `properties.message`. Object errors retain extension
fields while the known string and retry fields are normalized. The stored
error is cleared by the next user `message.updated` event, but it is not yet
projected into assistant-ui.

Tasks, tool progress, part progress, and `todowrite` updates are canonical
runtime state:

- the tasks snapshot accepts the proxy's `{ tasks: [...] }` wrapper;
- `tool.progress` appends by `toolUseID ?? parentToolUseID`;
- `task.started`, `task.progress`, and `task.completed` follow the state
  transitions in app-ai-native;
- tool `state.progress` retains the latest ten entries and clears on terminal
  status;
- `todowrite` tool input can update todo state before `todo.updated` arrives.

## UI boundary

`ConversationRuntimeProvider` projects the Query-backed state to
`ThreadMessageLike` and provides only real actions:

- `onNew` -> `conversation.promptAsync`
- `onCancel` -> `conversation.abort`

`Session` is a presentation component and does not choose a runtime. The issue
panel explicitly mounts `ConversationRuntimeProvider` after descriptor
resolution. Tests that need a runtime use a test-local external store instead
of shipping a fixture provider in the production package.

Permission/question snapshots and events are retained in canonical state and
the client exposes response methods. This change does not invent new
permission/question UI; a later change can bind those records to dedicated
assistant-ui tool components. Permission replies use the proxy contract
`{ decision: "once" | "always" | "reject" }`.

## app-ai-native parity

The matching behavior was checked directly against these source locations:

| Multica behavior | app-ai-native source |
| --- | --- |
| initial 200-message snapshot | `context/device-session.tsx`: `MESSAGE_INITIAL_LIMIT` and `loadMessages` |
| permission decision body | `context/device-session.tsx`: `permissionRespond` |
| task snapshot normalization | `context/device-session.tsx`: `loadTasks` |
| session error normalization and clearing | `context/device-session.tsx`: `session.error` and `message.updated` |
| tool output and call-ID update handling | `context/device-session.tsx`: `message.part.updated` |
| tool and part progress | `context/device-session.tsx`: `tool.progress` and `state.progress` handling |
| task lifecycle transitions | `context/device-session.tsx`: `task.started`, `task.progress`, and `task.completed` |
| todo fallback from tool input | `context/device-session.tsx`: `todowrite` handling |

Multica deliberately differs where the original implementation has a known
limitation: REST snapshots replace stale part membership, and all proxy
responses are schema-parsed at the network boundary.

## Protocol gaps

- `agent.runtime.restarted` and `host.git.*` remain out of scope and are not
  projected into conversation state.
- The available issue session document does not define history pagination
  response metadata. The issue runtime intentionally loads at most the latest
  200 messages without a load-more flow.
- Child-session trees are out of scope. Controllers continue to accept only
  events whose normalized session ID exactly matches the issue conversation ID.
- There is no event cursor in the documented stream, so reconnect always
  reconciles through REST.
- A captured production SSE fixture is not present in Multica. Parser tests
  cover the documented wrapped/raw forms and standard SSE framing.
