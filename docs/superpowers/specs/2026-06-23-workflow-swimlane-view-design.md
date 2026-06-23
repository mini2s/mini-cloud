# Workflow Swimlane View — Design Spec

**Date:** 2026-06-23  
**Status:** Design approved  
**Topic:** New swimlane view as default entry for `/workflows/[id]`

---

## Motivation

The current default view for `/workflows/[id]` is the Overview (stage cards + single-stage DAG). This requires clicking through each stage card to see its nodes, losing the holistic picture of how nodes connect across stages.

The new Swimlane view provides an at-a-glance architecture diagram — all stages shown as horizontal lanes, all nodes visible simultaneously, and edges crossing lanes to show the full data flow. Visual reference: `docs/cospowers-architecture.html`.

## Design Decisions

### View modes (three-way switch)

The `WorkflowViewMode` type gains a third value. Default changes from `"overview"` to `"swimlane"`.

```
viewMode: "swimlane" | "overview" | "editor"
```

Users who previously persisted `"overview"` via Zustand persist will keep their choice. New users (or users who haven't explicitly chosen) see swimlane first.

### Library choice: ReactFlow + SVG overlay

**Chosen:** ReactFlow (already in project) with a custom SVG overlay for lane backgrounds and headers.

**Rejected alternatives:**
- **Mermaid** — no swimlane layout, no custom positioning, no interaction
- **draw.io embedded viewer** — external CDN dependency, no custom click interaction, complex runtime XML generation
- **New chart library** — unnecessary; ReactFlow covers all requirements with zero new deps

ReactFlow provides: zoom/pan, custom node shapes (already built), `step` edge type for orthogonal routing, click interaction. The swimlane backgrounds and headers are rendered as an SVG element layered over the ReactFlow viewport with `pointer-events: none` (the headers get `pointer-events: auto`).

## Architecture

### Component tree

```
WorkflowDetailShell (modified)
  └─ viewMode === "swimlane"
      └─ WorkflowSwimlanePage (new)
            ├─ PageHeader (reused)
            ├─ viewToggle slot (reused)
            ├─ SwimlaneCanvas (new)
            │    ├─ ReactFlow (existing)
            │    │    ├─ WorkflowNode (reused reactflow-nodes.tsx)
            │    │    └─ step edges (ReactFlow built-in)
            │    └─ LaneOverlay (new — SVG rects + text)
            └─ NodeDetailPanel (reused — side drawer)
```

### Data flow

```
TanStack Query hooks (shared cache with overview/editor):
  workflowDetailOptions()   ─┐
  workflowStagesOptions()    ├─ same keys → zero duplicate fetches
  workflowNodesOptions()     │
  workflowEdgesOptions()    ─┘
       │
       ▼
  useMemo → computeSwimlaneLayout(nodes, edges, stages)
       │
       ▼
  SwimlaneCanvas receives { nodePositions, lanes, canvasSize }
```

## Layout Algorithm

**File:** `packages/views/workflows/components/swimlane/swimlane-layout.ts`

Pure function: `computeSwimlaneLayout(nodes, edges, stages) → SwimlaneLayoutResult`

### Phase 1: Per-stage horizontal layout

For each stage (sorted by `sort_order`):
1. Collect nodes with matching `stage_id`
2. Collect edges where both endpoints are in this stage
3. Run dagre with `rankdir: "LR"`, `nodesep: 60`, `ranksep: 120` on the subgraph
4. Record computed x/y within a stage-local coordinate space

Node dimensions come from `getNodeDimensions(formatSchema)` — the same function used by `computeAutoLayout` in `layout.ts`. This respects per-node shape overrides (rectangle=150×70, diamond=180×180, pill=150×70, hexagon=200×200).

### Phase 2: Lane stacking

```
LANE_HEIGHT = 260
LANE_HEADER_HEIGHT = 52
LANE_PADDING = 16
LANE_GAP = 8

laneY = index × (LANE_HEIGHT + LANE_GAP)
nodeAbsoluteY = laneY + LANE_HEADER_HEIGHT + LANE_PADDING + dagreNode.y
```

### Phase 3: Unassigned lane

Nodes with `stage_id === null` get their own lane at the bottom, dagre-laid out the same way. The lane has a dashed border and neutral gray color to distinguish from staged nodes.

### Edge routing

- **Intra-stage edges** (both endpoints in same lane): standard dagre routing within the lane
- **Inter-stage edges**: `type: 'step'` — ReactFlow produces orthogonal right-angle bends automatically since nodes are in different Y bands
- Edges between staged nodes and unassigned nodes: routed with `step` type, neutral color

## Visual Design

### Color palette

8-color cycling palette assigned by `sort_order % 8`:

| Index | Color | bg (8% opacity) | border |
|-------|-------|-----------------|--------|
| 0 | Indigo | `rgba(79,70,229,0.08)` | `#4F46E5` |
| 1 | Cyan | `rgba(8,145,178,0.08)` | `#0891B2` |
| 2 | Emerald | `rgba(5,150,105,0.08)` | `#059669` |
| 3 | Amber | `rgba(217,119,6,0.08)` | `#D97706` |
| 4 | Red | `rgba(220,38,38,0.08)` | `#DC2626` |
| 5 | Violet | `rgba(124,58,237,0.08)` | `#7C3AED` |
| 6 | Pink | `rgba(219,39,119,0.08)` | `#DB2777` |
| 7 | Blue | `rgba(37,99,235,0.08)` | `#2563EB` |

Unassigned lane: `#6B7280` (slate-500) with dashed border.

### Lane rendering

Each lane is a horizontal band with:
- Full-width colored background rect (palette `bg`)
- Left-side colored accent strip (palette `border`, 4px wide)
- Header text: stage name (white, bold, 13px) + node count badge
- Header click scrolls/centers the lane in viewport

### Edge colors

- Intra-stage edges: use the lane's palette `border` color
- Inter-stage edges: `#94A3B8` (slate-400)
- Edge width: 1.5px
- Arrow markers on all edges

### Empty states

| State | Behavior |
|-------|----------|
| No stages defined | Single lane with all nodes + message "Create stages in editor to organize nodes" |
| Stages exist, no nodes | Lanes rendered with "No nodes" text centered in each lane body |
| No nodes at all | Centered empty state with link to editor |

## Interaction

- **Read-only** — nodes are not draggable, edges cannot be created/deleted
- **Pan & zoom** — ReactFlow built-in scroll-to-zoom, drag-to-pan, Control buttons
- **Node click** — opens NodeDetailPanel (slide-out drawer, reused from overview)
- **Fit view on mount** — canvas auto-fits to show all lanes
- **Lane header click** — centers that lane in the viewport (nice-to-have, can defer)

## Files

### New files

| File | Responsibility |
|------|---------------|
| `packages/views/workflows/components/swimlane/index.ts` | Barrel export |
| `packages/views/workflows/components/swimlane/swimlane-layout.ts` | `computeSwimlaneLayout()` pure function |
| `packages/views/workflows/components/swimlane/swimlane-layout.test.ts` | Unit tests for layout logic |
| `packages/views/workflows/components/swimlane/swimlane-canvas.tsx` | ReactFlow + lane overlay rendering |
| `packages/views/workflows/components/swimlane/workflow-swimlane-page.tsx` | Page component (data fetch, state, composition) |
| `packages/views/workflows/components/swimlane/swimlane-page.test.tsx` | Page integration tests |

### Modified files

| File | Change |
|------|--------|
| `packages/core/workflows/stores/view-store.ts` | Add `"swimlane"` to type union; change default |
| `packages/views/workflows/components/workflow-detail-shell.tsx` | Add swimlane menu item + routing branch |
| `packages/views/locales/en/workflows.json` | Add `view.swimlane: "Swimlane"` |
| `packages/views/locales/zh-Hans/workflows.json` | Add `view.swimlane: "泳道图"` |

## Test Plan

### swimlane-layout.test.ts (Node env, no DOM)

1. Empty input → empty result
2. Single stage, single node → correct position
3. Multiple stages → lanes stacked vertically in sort_order
4. Cross-stage edges → edge data passed through unchanged
5. Unassigned nodes → placed in separate lane
6. Node dimensions match shape (rectangle/diamond/hexagon/pill)

### swimlane-page.test.tsx (jsdom)

1. Loading state → skeleton placeholders visible
2. Error state → alert + retry button
3. No stages → empty state message
4. Stages exist, no nodes → lanes with "No nodes"
5. Normal rendering → stages shown, nodes in correct lanes
6. Node click → detail panel opens
7. Close detail panel → panel dismissed
8. Click different node → panel content updates
9. View toggle → present in header (shared from shell)

## Implementation Order

1. **View store** — add `"swimlane"` type, change default
2. **i18n** — add translation keys
3. **swimlane-layout.ts** + **tests** — layout algorithm
4. **swimlane-canvas.tsx** — renderer component
5. **workflow-swimlane-page.tsx** — page component
6. **barrel export** — `index.ts`
7. **Shell integration** — modify `workflow-detail-shell.tsx`
8. **Page tests** — `swimlane-page.test.tsx`
9. **Manual verification** — run app, test all three view modes

Steps 1-3 can run in parallel.

## Verification

```bash
# Unit tests
pnpm --filter @multica/views exec vitest run swimlane-layout.test.ts
pnpm --filter @multica/views exec vitest run swimlane-page.test.tsx

# Full check
make check
```

Manual: `pnpm dev` → navigate to any workflow → verify swimlane is default → toggle to overview and editor → verify NodeDetailPanel works → test with workflows that have 0 stages, 1 stage, multiple stages.
