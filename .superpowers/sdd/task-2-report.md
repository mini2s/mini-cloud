# Task 2: LaneBgNode — swimlane background ReactFlow node

## Status: DONE

## TDD Evidence

### RED phase (test fails because module does not exist)

**Command:**
```
pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx
```

**Output:**
```
 FAIL  workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx
Error: Failed to resolve import "./lane-bg-node" from "...lane-bg-node.test.tsx". Does the file exist?

Test Files  1 failed (1)
     Tests  no tests
```

### GREEN phase (all 5 tests pass after implementation)

**Command:**
```
pnpm --filter @multica/views exec vitest run workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx
```

**Output:**
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  2.55s
```

## Files Created

- `packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.tsx` — LaneBgNode ReactFlow custom node component
- `packages/views/workflows/components/overview/reactflow-nodes/lane-bg-node.test.tsx` — Unit tests (5 test cases)

## Implementation Details

- **Interface:** `LaneBgNodeData { stageIndex: number }`
- **Node type:** `"laneBg"` (ReactFlow custom node)
- **Consumes:** `STAGE_BG_COLORS`, `LANE_HEIGHT` (128px), `PANORAMA_WIDTH` (2400px) from `../constants`
- **Color cycling:** `Math.abs(stageIndex) % STAGE_BG_COLORS.length` for safe modulo
- **Non-interactive:** `data-nodrag="true"` + `pointer-events-none` CSS class
- **Minor divergence from brief:** Node IDs in test use plain numbers (`"0"`, `"1"`, `"99"`) instead of `"lane-0"` to match the `data-testid={`lane-bg-${id}`}` pattern in the component

## Post-Review Fix (2026-06-30)

**Issue:** `LaneBgNodeData` was missing `stageName?: string` as required by the spec (`{ stageIndex: number; stageName?: string }`).

**Fix:** Added `stageName?: string` to the `LaneBgNodeData` interface in `lane-bg-node.tsx`.

**Test Results:**
```
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  2.56s
```

**Commit:**

`b74df322` fix(workflows): add missing stageName field to LaneBgNodeData interface
