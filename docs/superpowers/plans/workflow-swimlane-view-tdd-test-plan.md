# Workflow Swimlane View — TDD E2E Test Plan

**Feature:** Workflow 泳道图视图（`/workflows/[id]` 默认视图）
**Design doc:** `docs/superpowers/specs/2026-06-23-workflow-swimlane-view-design.md`
**Implementation plan:** `docs/superpowers/plans/2026-06-23-workflow-swimlane-view-plan.md`
**Generated:** 2026-06-23
**Tool:** playwright-cli (spec-driven testing: plan → generate → heal)
**Test approach:** TDD — E2E tests written BEFORE implementation, expected to fail until features are built

## Application Overview

The Workflow Swimlane View is the **new default view** for `/workflows/[id]`. It replaces the Overview (stage cards + single-stage DAG) as the first thing users see. The swimlane view shows all stages as **horizontal color-coded lanes** stacked vertically, with all nodes auto-laid out within their lanes via dagre. Cross-lane edges use ReactFlow `step` type for orthogonal routing. Nodes are read-only but clickable — clicking opens the shared NodeDetailPanel slide-out drawer. A three-way DropdownMenu toggle (Swimlane / Overview / Editor) in the header switches between views. View preference persists per workspace via Zustand.

Key differences from Overview view:
- **All stages visible at once** as lanes (not click-to-select cards)
- **All nodes visible simultaneously** across all lanes
- **Cross-lane edges** with orthogonal step routing
- **Color-coded lanes** (8-color palette, cycled by `sort_order % 8`)
- **Unassigned lane** at bottom with dashed border for `stage_id = null` nodes
- **Three-way toggle** (Swimlane/Overview/Editor) not two-way

## TDD Strategy

Tests are written **before** implementation code. Initial runs will fail (expected). Tests guide implementation — once all tests pass, the feature is complete.

### TDD workflow

```
1. Write seed test           → FAIL (no seed data, no swimlane UI)
2. Write E2E scenarios       → FAIL (no swimlane implementation)
3. Implement view store      → partial pass (type system accepts "swimlane")
4. Implement i18n            → partial pass (translation keys available)
5. Implement layout.ts       → unit tests pass (pure function, no DOM)
6. Implement canvas.tsx      → unit tests pass (ReactFlow mocked)
7. Implement page.tsx        → integration tests pass
8. Implement shell           → E2E tests begin passing
9. All E2E tests green       → FEATURE COMPLETE
```

### Test pyramid for this feature

| Layer | Tool | Count | Scope |
|-------|------|-------|-------|
| Unit (layout) | Vitest (Node) | 9 tests | `computeSwimlaneLayout` pure function |
| Integration (page) | Vitest (jsdom) | 9 tests | `WorkflowSwimlanePage` with mocked deps |
| E2E (full stack) | Playwright | 24 scenarios | Real browser, real backend, real API |

This plan covers the **E2E layer**. The unit and integration test cases are already defined in the implementation plan; E2E tests complement them by verifying the full stack.

## Self-Healing Strategy

All tests follow these resilience principles to minimize locator drift:

| Principle | Implementation |
|-----------|---------------|
| **Semantic locators** | Prefer `getByRole()`, `getByLabel()`, `getByTestId()` over CSS class selectors |
| **Text pattern matching** | Use regex (`/Stage \\d+/`) over exact string matches for dynamic content |
| **ARIA snapshots** | Use `toMatchAriaSnapshot()` for structural assertions — survives layout refactors |
| **data-testid anchors** | Recommended `data-testid` attributes documented per component; if missing, tests fall back to role+name |
| **Heal workflow** | Each scenario's `// heal:` comments document likely drift patterns and recovery actions |

### Recommended data-testid attributes

For maximum test stability, the implementation should include these `data-testid` attributes:

| Component | data-testid | Purpose |
|-----------|------------|---------|
| `SwimlaneCanvas` wrapper | `swimlane-canvas` | Container anchor |
| `SwimlaneCanvas` ReactFlow | `swimlane-reactflow` | ReactFlow container |
| SVG lane overlay | `swimlane-overlay` | Lane backgrounds + headers |
| Lane group (per stage) | `swimlane-lane-{stageId}` | Individual lane targeting |
| Lane header | `swimlane-lane-header-{stageId}` | Lane header click target |
| `NodeDetailPanel` | `node-detail-panel` | Drawer container |
| `NodeDetailPanel` (close) | `node-detail-close` | Close button |
| `SwimlaneSkeleton` | `swimlane-skeleton` | Loading state |
| `EmptySwimlaneState` | `swimlane-empty-state` | Empty state CTA |
| `EmptyLaneState` | `swimlane-empty-lane-{stageId}` | Empty lane placeholder |
| View toggle button | `view-toggle` | DropdownMenu trigger |
| View toggle dropdown | `view-toggle-dropdown` | DropdownMenu content |

---

## Test Scenarios

### 1. Navigation & Page Shell

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 1.1. swimlane-is-default-view

**File:** `e2e/workflow-swimlane/swimlane-is-default-view.spec.ts`

**Steps:**
1. From workspace dashboard, navigate to workflow list
   - expect: URL matches `/{slug}/workflows`
2. Click on a workflow to open its detail page
   - expect: URL matches `/{slug}/workflows/{id}` (no `/overview` or `/editor` suffix)
   - expect: swimlane canvas is visible (ReactFlow with multiple horizontal lanes)
   - expect: page heading contains workflow name
3. Verify the view toggle button shows swimlane icon (LayoutGrid) as active
   - expect: view toggle button is visible

**Heal hints:**
- Swimlane is the new default — `/workflows/{id}` renders swimlane, not overview
- If view toggle icon changes, check button title attribute
- URL should NOT have a view-specific suffix (view is internal state, not URL)

#### 1.2. swimlane-page-shell-structure

**File:** `e2e/workflow-swimlane/swimlane-page-shell.spec.ts`

**Steps:**
1. Navigate directly to a workflow detail page with stages and nodes
   - expect: three main zones — PageHeader with workflow name + view toggle, swimlane canvas (ReactFlow + lanes), no detail panel initially
2. Verify the canvas fills the main content area
   - expect: ReactFlow container visible with zoom controls
3. Verify lane overlay is present
   - expect: SVG overlay with colored lane backgrounds visible
4. Verify no detail panel is shown initially
   - expect: detail panel drawer is absent or hidden

**Heal hints:**
- Use `toMatchAriaSnapshot` on the page root to verify zone structure
- ReactFlow container: `.react-flow` or `[data-testid="swimlane-reactflow"]`
- Lane overlay: `[data-testid="swimlane-overlay"]` with `<rect>` elements

### 2. Swimlane Canvas Rendering

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 2.1. all-stages-rendered-as-lanes

**File:** `e2e/workflow-swimlane/all-stages-rendered-as-lanes.spec.ts`

**Steps:**
1. Seed a workflow with 3 stages ("需求", "设计", "编码") via API
2. Navigate to the workflow detail page
   - expect: exactly 3 lane groups visible in the canvas
   - expect: each lane has a colored header with the stage name
3. Verify lane headers show correct names
   - expect: header text "需求" visible
   - expect: header text "设计" visible
   - expect: header text "编码" visible
4. Verify lanes are stacked vertically in `sort_order`
   - expect: "需求" lane is above "设计" lane
   - expect: "设计" lane is above "编码" lane

**Heal hints:**
- Lane header text: `[data-testid="swimlane-overlay"] text` elements
- Lane order: check SVG `<g>` element order or `y` attribute values
- Stage names may be dynamic — use regex or data-testid per lane

#### 2.2. all-nodes-visible-in-lanes

**File:** `e2e/workflow-swimlane/all-nodes-visible-in-lanes.spec.ts`

**Steps:**
1. Seed a workflow with 2 stages, each having 2 nodes
2. Navigate to the workflow detail page
   - expect: 4 ReactFlow nodes visible total (not just one stage's nodes)
   - expect: nodes from stage 1 are positioned within lane 1's Y bounds
   - expect: nodes from stage 2 are positioned within lane 2's Y bounds
3. Verify no need to click stage cards to see different nodes
   - expect: all nodes from all stages are visible without any interaction

**Heal hints:**
- ReactFlow nodes: `.react-flow__node` elements
- Node count: verify total `.react-flow__node` count matches seeded node count
- Lane bounds: compare node `transform` or position with lane Y coordinates

#### 2.3. lanes-are-color-coded

**File:** `e2e/workflow-swimlane/lanes-color-coded.spec.ts`

**Steps:**
1. Seed a workflow with 3 stages (sort_order 0, 1, 2)
2. Navigate to the workflow detail page
   - expect: each lane has a different background color
   - expect: lane 0 uses indigo palette colors
   - expect: lane 1 uses cyan palette colors
   - expect: lane 2 uses emerald palette colors
3. Verify lane headers have the palette border color
   - expect: each header's fill color differs from others

**Heal hints:**
- Check SVG `<rect>` fill attribute or CSS `background-color`
- Colors are rgba with 8% opacity — check the rgba string
- 8-color palette cycles at sort_order 8

#### 2.4. unassigned-nodes-lane

**File:** `e2e/workflow-swimlane/unassigned-nodes-lane.spec.ts`

**Steps:**
1. Seed a workflow with stages AND some nodes with `stage_id = null`
2. Navigate to the workflow detail page
   - expect: an additional lane at the bottom with "Unassigned" or "未分组" header
   - expect: unassigned lane has dashed border (stroke-dasharray)
   - expect: unassigned lane uses neutral gray color (#6B7280)
   - expect: nodes with `stage_id = null` appear in the unassigned lane
3. Verify unassigned lane is always last
   - expect: unassigned lane is below all stage lanes

**Heal hints:**
- "Unassigned" text: `/Unassigned|未分组/`
- Dashed border: `stroke-dasharray` attribute on the lane `<rect>`
- Lane ordering: last `<g>` in the SVG overlay

#### 2.5. loading-skeleton-displayed

**File:** `e2e/workflow-swimlane/loading-skeleton.spec.ts`

**Steps:**
1. Intercept the workflow API requests with a 2-second delay
2. Navigate to the workflow detail page
   - expect: skeleton placeholder lanes visible (gray pulsing rectangles)
   - expect: at least 3 skeleton bars visible
3. Wait for API responses
   - expect: skeleton disappears
   - expect: real lanes with colored headers appear
   - expect: no error state shown

**Heal hints:**
- Route delay: `page.route('**/api/workflows/**', async route => { setTimeout(() => route.continue(), 2000); })`
- Skeleton selector: `[data-testid="swimlane-skeleton"]` or `.animate-pulse`

#### 2.6. empty-state-when-no-stages

**File:** `e2e/workflow-swimlane/empty-state-no-stages.spec.ts`

**Steps:**
1. Seed a workflow with zero stages (nodes may exist with `stage_id = NULL`)
2. Navigate to the workflow detail page
   - expect: empty state message visible — "Create stages in editor to organize nodes" or Chinese equivalent
   - expect: a button or link to navigate to the editor view
3. Click the editor link
   - expect: view switches to editor mode (ReactFlow editable DAG visible)

**Heal hints:**
- Empty text regex: `/Create stages|创建阶段|在编辑器中/`
- View switch: verify URL still at `/workflows/{id}` but editor DAG visible

#### 2.7. many-lanes-vertical-scroll

**File:** `e2e/workflow-swimlane/many-lanes-scroll.spec.ts`

**Steps:**
1. Seed a workflow with 8 stages, each containing 2-3 nodes
2. Navigate to the workflow detail page
   - expect: not all lanes fit in viewport at once
   - expect: vertical scroll is possible on the canvas
3. Scroll to the bottom lane
   - expect: last stage lane is visible
   - expect: first stage lane is partially or fully scrolled out of view
4. Use zoom controls to fit all lanes
   - expect: fit-view button zooms out to show all lanes

**Heal hints:**
- Canvas has `overflow-y: auto` via ReactFlow's built-in scroll
- fit-view: `.react-flow__controls-fitview` button
- Check `scrollHeight > clientHeight` on the ReactFlow container

### 3. Cross-Lane Edges

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 3.1. intra-stage-edges-within-lane

**File:** `e2e/workflow-swimlane/intra-stage-edges.spec.ts`

**Steps:**
1. Seed a stage with 3 nodes connected sequentially (A→B→C)
2. Navigate to the workflow detail page
   - expect: 2 edges visible connecting the nodes
   - expect: edges are within the same lane visually
   - expect: edges use the lane's palette border color (not neutral gray)
3. Verify edges have arrow markers
   - expect: each edge has an arrowhead at the target end

**Heal hints:**
- ReactFlow edges: `.react-flow__edge` elements
- Edge color: check `stroke` attribute on edge `<path>`
- Arrow markers: `marker-end` attribute

#### 3.2. cross-stage-edges-step-routing

**File:** `e2e/workflow-swimlane/cross-stage-edges.spec.ts`

**Steps:**
1. Seed a workflow with 2 stages, node in stage 1 → node in stage 2
2. Navigate to the workflow detail page
   - expect: an edge visible connecting the cross-stage nodes
   - expect: edge uses orthogonal/step routing (right-angle bends)
   - expect: edge color is neutral gray (#94A3B8 / slate-400)
3. Verify edge crosses the lane boundary
   - expect: edge source Y is in stage 1's lane
   - expect: edge target Y is in stage 2's lane

**Heal hints:**
- Step routing: edge `type` is `step` in ReactFlow
- Cross-lane edge color: slate-400 = `#94A3B8`
- Lane boundary crossing: compare source/target node Y positions

#### 3.3. edges-to-unassigned-nodes

**File:** `e2e/workflow-swimlane/edges-to-unassigned.spec.ts`

**Steps:**
1. Seed a staged node connected to an unassigned node (stage_id = null)
2. Navigate to the workflow detail page
   - expect: edge visible connecting staged node → unassigned node
   - expect: edge color is neutral gray (inter-stage coloring)
   - expect: edge crosses from stage lane to unassigned lane

**Heal hints:**
- Same verification pattern as cross-stage edges
- Unassigned lane is at the bottom

### 4. Node Interaction (Read-Only)

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 4.1. nodes-are-not-draggable

**File:** `e2e/workflow-swimlane/nodes-read-only.spec.ts`

**Steps:**
1. Navigate to a workflow detail page with nodes
2. Attempt to drag a node by its center
   - expect: node does NOT move (position unchanged after drag attempt)
3. Verify no edge creation handles on nodes
   - expect: no connection handles visible on node edges
4. Press Delete key while a node is focused
   - expect: nothing is deleted (node still visible)

**Heal hints:**
- ReactFlow `nodesDraggable={false}` — attempt drag via Playwright, verify position unchanged
- Connection handles: `.react-flow__handle` should be absent or `display: none`
- Delete key: `page.keyboard.press('Delete')` then verify node count unchanged

#### 4.2. pan-and-zoom-works

**File:** `e2e/workflow-swimlane/pan-zoom.spec.ts`

**Steps:**
1. Navigate to a workflow detail page with 3+ lanes
2. Use mouse wheel to zoom in
   - expect: canvas zoom level changes (elements appear larger)
3. Use zoom-out control button
   - expect: canvas zooms out
4. Use fit-view control button
   - expect: all lanes visible within viewport
5. Drag to pan the canvas
   - expect: viewport position changes

**Heal hints:**
- Zoom controls: `.react-flow__controls-zoomIn`, `.react-flow__controls-zoomOut`, `.react-flow__controls-fitview`
- Pan: mouse drag on the ReactFlow background (not on a node)

### 5. Node Detail Panel

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 5.1. detail-panel-opens-on-node-click

**File:** `e2e/workflow-swimlane/detail-panel-open.spec.ts`

**Steps:**
1. Navigate to a workflow detail page with nodes that have worker/critic configured
2. Click on a node in the swimlane canvas
   - expect: a slide-out drawer panel opens on the right side
   - expect: panel shows the node name as title
   - expect: clicked node gets selected visual state in canvas
3. Verify key sections are present
   - expect: "Worker" section visible
   - expect: "Critic" section visible
   - expect: "Format Schema" section visible
   - expect: "Relations" section visible

**Heal hints:**
- Panel selector: `[data-testid="node-detail-panel"]` or `[role="dialog"]` or `[role="complementary"]`
- Section headings: regex `/Worker|Critic|Format Schema|Relations/`
- Node selection: check for `.selected` class on ReactFlow node

#### 5.2. detail-panel-shows-configured-values

**File:** `e2e/workflow-swimlane/detail-panel-configured.spec.ts`

**Steps:**
1. Seed a node with: worker type "agent", assigned to "TestAgent", critic type "human", format_schema with JSON
2. Navigate, click the node in swimlane
   - expect: Worker section shows "agent" and "TestAgent"
   - expect: Critic section shows "human" and reviewer info
   - expect: Format Schema section shows formatted JSON content
   - expect: Relations section shows upstream/downstream connections

**Heal hints:**
- Same assertions as overview's detail panel (reused component)
- JSON display: pretty-printed or syntax-highlighted

#### 5.3. detail-panel-shows-unconfigured-state

**File:** `e2e/workflow-swimlane/detail-panel-unconfigured.spec.ts`

**Steps:**
1. Seed a node with no worker, no critic, no format_schema
2. Click the node in swimlane
   - expect: Worker section shows "Not configured" or "未配置"
   - expect: Critic section shows "Not configured" or "未配置"
   - expect: Format Schema section shows "No format constraints" or "无格式约束"

**Heal hints:**
- "未配置" text style: `text-muted-foreground` class or reduced opacity

#### 5.4. detail-panel-close-methods

**File:** `e2e/workflow-swimlane/detail-panel-close.spec.ts`

**Steps:**
1. Open detail panel by clicking a node
2. Click the × close button
   - expect: panel closes
   - expect: node deselects in canvas
3. Click another node to reopen
4. Click on canvas background (not on a node)
   - expect: panel closes
5. Click a node to reopen, then press Escape
   - expect: panel closes

**Heal hints:**
- Close button: `[data-testid="node-detail-close"]` or `[aria-label="Close"]`
- Escape: `page.keyboard.press('Escape')`
- Canvas background click: click on `.react-flow__background` or empty area

#### 5.5. switching-nodes-updates-panel

**File:** `e2e/workflow-swimlane/detail-panel-switch-node.spec.ts`

**Steps:**
1. Open detail panel for node A (in stage 1's lane)
2. Click node B in stage 2's lane (different lane)
   - expect: panel content updates to node B's details
   - expect: panel does NOT close and reopen
   - expect: node A deselects, node B selects
3. Verify panel still works after lane change
   - expect: panel title matches node B's name

**Heal hints:**
- Panel container persists; child content changes
- Nodes in different lanes have clearly different Y positions

### 6. View Toggle (Three-Way)

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 6.1. view-toggle-dropdown-shows-three-options

**File:** `e2e/workflow-swimlane/view-toggle-options.spec.ts`

**Steps:**
1. Navigate to a workflow detail page (swimlane is default)
2. Click the view toggle button
   - expect: dropdown menu opens with 3 options
   - expect: "Swimlane" / "泳道图" option visible with LayoutGrid icon
   - expect: "Overview" / "概览" option visible with Layers icon
   - expect: "Editor" / "编辑器" option visible with Pen icon
3. Verify current view (swimlane) is indicated
   - expect: the toggle button shows LayoutGrid icon

**Heal hints:**
- DropdownMenu trigger: `[data-testid="view-toggle"]` or button with view-related icon
- Three options: check for 3 `[role="menuitem"]` elements
- Icons may change — verify by text content rather than icon type

#### 6.2. switch-to-overview-view

**File:** `e2e/workflow-swimlane/view-toggle-to-overview.spec.ts`

**Steps:**
1. Navigate to a workflow detail page (swimlane is default)
2. Open view toggle, click "Overview" / "概览"
   - expect: view switches to overview (stage cards + single-stage DAG)
   - expect: stage canvas area visible (horizontal card strip)
   - expect: toggle button now shows Layers icon
3. Reload the page
   - expect: overview view persists (Zustand persist)
   - expect: URL is still `/workflows/{id}` (no suffix)

**Heal hints:**
- View switch: swimlane canvas disappears, stage card strip appears
- Persistence: after reload, check view mode didn't revert to swimlane
- URL: stays at `/workflows/{id}` for all three views

#### 6.3. switch-to-editor-view

**File:** `e2e/workflow-swimlane/view-toggle-to-editor.spec.ts`

**Steps:**
1. Navigate to a workflow detail page (swimlane is default)
2. Open view toggle, click "Editor" / "编辑器"
   - expect: view switches to editor (editable ReactFlow DAG)
   - expect: nodes are draggable in editor
   - expect: toggle button now shows Pen icon
3. Switch back to swimlane via toggle
   - expect: swimlane view restored
   - expect: all lanes visible

**Heal hints:**
- Editor: ReactFlow with `nodesDraggable={true}`, different layout
- Switching back: swimlane canvas reappears with lanes

#### 6.4. view-toggle-from-overview-to-swimlane

**File:** `e2e/workflow-swimlane/view-toggle-to-swimlane.spec.ts`

**Steps:**
1. Set view preference to "overview" (via localStorage or by toggling first)
2. Navigate to the workflow detail page
   - expect: overview view loads (respects persisted preference)
3. Open view toggle, click "Swimlane" / "泳道图"
   - expect: view switches to swimlane
   - expect: all lanes visible with all nodes
4. Reload
   - expect: swimlane view persists

**Heal hints:**
- This tests the "overview → swimlane" direction (non-default path)
- localStorage key for persistence: check Zustand persist config

### 7. Cross-View Data Consistency

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 7.1. stage-creation-syncs-to-swimlane

**File:** `e2e/workflow-swimlane/stage-creation-sync.spec.ts`

**Steps:**
1. Navigate to a workflow in overview view
2. Create a new stage "新阶段" via overview's add-stage dialog
3. Switch to swimlane view
   - expect: new lane "新阶段" appears in the swimlane canvas
   - expect: lane count increases by 1
4. Switch back to overview
   - expect: new stage card visible in the strip

**Heal hints:**
- TanStack Query cache: same key for both views, data should be consistent
- Lane count: check number of SVG `<g>` lane groups

#### 7.2. editor-node-changes-sync-to-swimlane

**File:** `e2e/workflow-swimlane/editor-node-sync.spec.ts`

**Steps:**
1. Navigate to a workflow in editor view
2. Add a new node to a stage and save
3. Switch to swimlane view
   - expect: new node appears in the correct lane
   - expect: node is read-only (not draggable) in swimlane
4. Verify edge connections from editor are visible in swimlane
   - expect: new edges rendered with correct colors

**Heal hints:**
- Cache invalidation: after editor mutation, swimlane refetches on view switch
- If stale: wait for background refetch or reload

#### 7.3. node-detail-panel-same-across-views

**File:** `e2e/workflow-swimlane/detail-panel-cross-view.spec.ts`

**Steps:**
1. In swimlane view, click node X → detail panel shows worker "AgentA"
2. Close panel, switch to overview view
3. Click same node X in overview's DAG
   - expect: detail panel shows same worker "AgentA" (same data)
4. Compare panel content between views
   - expect: Worker, Critic, Format Schema sections are identical

**Heal hints:**
- NodeDetailPanel is a shared component — content should be identical
- Same node ID across views → same API data → same panel render

### 8. Error & Edge Cases

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 8.1. workflow-not-found-404

**File:** `e2e/workflow-swimlane/not-found.spec.ts`

**Steps:**
1. Navigate to `/{slug}/workflows/non-existent-id`
   - expect: error state displayed (404 or "not found")
   - expect: page does NOT show loading skeleton indefinitely
   - expect: page does NOT white-screen
   - expect: "Back to workflows" button or link present

**Heal hints:**
- 404: look for `/not.?found|404/` text or Alert component with destructive variant
- URL: `/workflows/non-existent-id` (no view suffix)

#### 8.2. api-error-with-retry

**File:** `e2e/workflow-swimlane/api-error-retry.spec.ts`

**Steps:**
1. Intercept the workflow GET API to return 500
2. Navigate to the workflow detail page
   - expect: error alert visible
   - expect: "Retry" button present
3. Remove the API interception
4. Click "Retry"
   - expect: data loads successfully
   - expect: swimlane lanes and nodes appear

**Heal hints:**
- Error alert: `[role="alert"]` or `.destructive` variant
- Retry button: `getByRole('button', { name: /retry|重试/i })`
- Route mock: `page.route('**/api/workflows/*', async route => { await route.fulfill({ status: 500 }); })`

#### 8.3. no-workspace-access

**File:** `e2e/workflow-swimlane/no-access.spec.ts`

**Steps:**
1. Log in as a user who is NOT a member of the target workspace
2. Navigate to `/{slug}/workflows/{id}`
   - expect: access denied / "No access" page displayed
   - expect: no workflow data leaked in the DOM
   - expect: no swimlane canvas visible

**Heal hints:**
- `NoAccessPage` component: existing shared component
- Data leak check: no `.react-flow__node` elements

### 9. Responsive & Accessibility

**Seed:** `e2e/seed-workflow-swimlane.spec.ts`

#### 9.1. responsive-layout-below-breakpoint

**File:** `e2e/workflow-swimlane/responsive-mobile.spec.ts`

**Steps:**
1. Resize viewport to 800×600 (below 1024px breakpoint)
2. Navigate to the workflow detail page
   - expect: lanes are still visible (vertical stacking is natural for narrow screens)
   - expect: detail panel opens as full-width bottom sheet instead of side drawer
3. Verify controls are accessible
   - expect: zoom controls visible and tappable

**Heal hints:**
- Resize: `page.setViewportSize({ width: 800, height: 600 })`
- Bottom sheet: check drawer CSS transform or position

#### 9.2. keyboard-navigation

**File:** `e2e/workflow-swimlane/keyboard-navigation.spec.ts`

**Steps:**
1. Navigate to the workflow detail page
2. Press Tab to focus first interactive element
   - expect: focus ring visible on a focusable element
3. Press Escape
   - expect: if detail panel open, it closes
   - expect: if detail panel closed, no-op (no error)

**Heal hints:**
- Focus ring: `:focus-visible` pseudo-class
- Escape: `page.keyboard.press('Escape')`

---

## Seed Test

Create `e2e/seed-workflow-swimlane.spec.ts` before generating scenario tests:

```typescript
// e2e/seed-workflow-swimlane.spec.ts
// Seed test for workflow swimlane view feature.
// All swimlane scenarios assume a logged-in user on a workspace-scoped
// workflow detail page (swimlane view) with pre-seeded data.
//
// Individual scenarios may extend this with additional API seeding.

import { test as baseTest, expect } from "@playwright/test";
import { loginAsDefault, createTestApi } from "./helpers";
import type { TestApiClient } from "./fixtures";

interface SwimlaneFixtures {
  slug: string;
  seededApi: TestApiClient;
}

const test = baseTest.extend<SwimlaneFixtures>({
  slug: async ({ page }, use) => {
    const slug = await loginAsDefault(page);
    await use(slug);
  },
  seededApi: async ({ page }, use) => {
    const api = await createTestApi();
    await use(api);
  },
});

export { test, expect };
export type { SwimlaneFixtures };
```

---

## Generation & Heal Workflow

### Initial generation

```bash
# 1. Verify Playwright workspace
npx --no-install playwright --version

# 2. Start the app (backend + frontend must be running)
# make start  (in another terminal)

# 3. Generate seed test first
PLAYWRIGHT_HTML_OPEN=never npx playwright test e2e/seed-workflow-swimlane.spec.ts --debug=cli
playwright-cli attach tw-XXXX
playwright-cli resume
# Explore the app, verify seed works
playwright-cli close

# 4. Generate each scenario one at a time
PLAYWRIGHT_HTML_OPEN=never npx playwright test e2e/seed-workflow-swimlane.spec.ts --debug=cli
playwright-cli attach tw-XXXX
playwright-cli resume
# Walk through scenario steps per the spec
# Copy generated TypeScript into the target .spec.ts file
playwright-cli close

# 5. Run generated tests
npx playwright test e2e/workflow-swimlane/
```

### Healing failing tests

```bash
# 1. Run all swimlane tests, capture failures
npx playwright test e2e/workflow-swimlane/

# 2. For each failing test, debug:
PLAYWRIGHT_HTML_OPEN=never npx playwright test <failing-file>:<line> --debug=cli
playwright-cli attach tw-XXXX

# 3. Diagnose with snapshots, console, network
playwright-cli snapshot
playwright-cli console
playwright-cli requests

# 4. Rehearse corrected interaction
playwright-cli click <corrected-ref>
# Copy the corrected TypeScript from output

# 5. Edit the test file with the fix
# 6. Rerun to confirm green
npx playwright test <failing-file>

# 7. Reconcile with spec:
#    - Pure locator drift → fix test only
#    - App behavior changed → update this spec file
#    - Unclear if regression → ask user before changing
```

### Common drift patterns & recovery

| Drift symptom | Likely cause | Recovery action |
|--------------|-------------|-----------------|
| Lane header text not found | i18n key or stage name changed | Use regex fallback, check `locales/*/workflows.json` |
| Node detail panel not opening | Drawer component changed | Check for `[role="dialog"]` or `[role="complementary"]` |
| Swimlane canvas not visible | Component renamed or restructured | Check for `.react-flow` container or `[data-testid="swimlane-reactflow"]` |
| View toggle has wrong options | DropdownMenu items changed | Check for 3 `[role="menuitem"]` elements |
| Lane colors don't match | Palette changed | Check `STAGE_PALETTE` in `swimlane-layout.ts` |
| "Unassigned" lane missing | Text changed or logic changed | Check `stage_id = null` handling in API |
| Cross-lane edges wrong color | Edge coloring logic changed | Check `sameLane` detection in `swimlane-canvas.tsx` |
| Default view not swimlane | View store default changed | Check `view-store.ts` default value |
| View persists wrong after reload | Zustand persist key changed | Check localStorage key name |

---

## Test Coverage Matrix

| # | Scenario | Happy Path | Edge Case | Error | Accessibility |
|---|----------|-----------|-----------|-------|---------------|
| 1.1 | swimlane-is-default-view | ✓ | — | — | — |
| 1.2 | swimlane-page-shell-structure | ✓ | — | — | — |
| 2.1 | all-stages-rendered-as-lanes | ✓ | — | — | — |
| 2.2 | all-nodes-visible-in-lanes | ✓ | — | — | — |
| 2.3 | lanes-are-color-coded | ✓ | — | — | — |
| 2.4 | unassigned-nodes-lane | — | ✓ | — | — |
| 2.5 | loading-skeleton-displayed | ✓ | — | — | — |
| 2.6 | empty-state-no-stages | — | ✓ | — | — |
| 2.7 | many-lanes-scroll | — | ✓ | — | — |
| 3.1 | intra-stage-edges | ✓ | — | — | — |
| 3.2 | cross-stage-edges | ✓ | — | — | — |
| 3.3 | edges-to-unassigned | — | ✓ | — | — |
| 4.1 | nodes-read-only | ✓ | — | — | — |
| 4.2 | pan-zoom | ✓ | — | — | — |
| 5.1 | detail-panel-open | ✓ | — | — | — |
| 5.2 | detail-panel-configured | ✓ | — | — | — |
| 5.3 | detail-panel-unconfigured | — | ✓ | — | — |
| 5.4 | detail-panel-close | ✓ | — | — | — |
| 5.5 | detail-panel-switch-node | — | ✓ | — | — |
| 6.1 | view-toggle-options | ✓ | — | — | — |
| 6.2 | view-toggle-to-overview | ✓ | — | — | — |
| 6.3 | view-toggle-to-editor | ✓ | — | — | — |
| 6.4 | view-toggle-to-swimlane | — | ✓ | — | — |
| 7.1 | stage-creation-sync | — | ✓ | — | — |
| 7.2 | editor-node-sync | — | ✓ | — | — |
| 7.3 | detail-panel-cross-view | — | ✓ | — | — |
| 8.1 | not-found-404 | — | — | ✓ | — |
| 8.2 | api-error-retry | — | — | ✓ | — |
| 8.3 | no-access | — | — | ✓ | — |
| 9.1 | responsive-mobile | — | ✓ | — | ✓ |
| 9.2 | keyboard-navigation | — | — | — | ✓ |

**Totals:** 24 scenarios — 12 Happy Path, 9 Edge Case, 3 Error, 2 Accessibility

---

## Relationship to Unit/Integration Tests

This E2E plan complements the existing test plan in the implementation plan:

| Test Layer | Count | What it covers |
|------------|-------|---------------|
| `swimlane-layout.test.ts` (Vitest, Node) | 9 | Layout algorithm correctness, edge cases |
| `swimlane-page.test.tsx` (Vitest, jsdom) | 9 | Component rendering, state transitions |
| **E2E (Playwright) ← this plan** | **24** | Full-stack integration, real browser |

**TDD execution order:**
1. Write this E2E plan ✓ (current step)
2. Write E2E seed + scenario test files (all fail initially)
3. Implement `swimlane-layout.ts` → layout unit tests pass
4. Implement `swimlane-canvas.tsx` + `workflow-swimlane-page.tsx` → page integration tests pass
5. Integrate into `workflow-detail-shell.tsx` → E2E tests begin passing
6. All 24 E2E scenarios green → feature complete
