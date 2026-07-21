# Workflow Editor UX Follow-up Design

## Goal

Resolve the visual regressions identified after enlarging workflow cards without changing workflow execution, API payloads, or stored graph semantics.

## Scope

- Remove duplicate split-rule presentation in the node detail panel.
- Remove redundant selected-actor summary blocks below assignment controls.
- Enforce a minimum horizontal gap between nodes in both the workflow editor and issue execution panorama.
- Align Worker and Critic metadata within cards.
- Keep the visible terms `Worker` and `Critic`, but source them from workflow locale files instead of hard-coding them in the editor card.

## Detail Panel

`NodeDetailSection` remains the single owner of the split-rule heading, icon, and explanatory copy. `SplitConfigPanel` becomes an unframed control group and no longer repeats that heading or description inside a nested card.

Direct assignee and role controls already display the selected value. The additional `ActorSummary` repeats that value and adds generic guidance, so it will be removed from Worker, Critic, and split-planner assignment modes. API-specific configuration guidance remains because it conveys information not present in the control.

## Canvas Spacing

The shared canvas model will normalize node positions per stage after reading stored coordinates. Nodes are sorted by stored `position_x`; the first node retains its position, and each later node is placed at the greater of its stored position or the previous rendered position plus card width plus an 80 px gap.

This rule has the following properties:

- It applies consistently to the workflow editor and issue execution panorama.
- It only shifts nodes that are too close; intentional larger gaps are preserved.
- It does not mutate the database during rendering.
- Editor drag operations continue to persist the node's actual displayed coordinate.
- Edges use the same normalized node positions, so node and edge geometry remain consistent.

## Card Metadata

Worker and Critic slots use an explicit two-row layout: a fixed-height label row and a top-aligned value row. Both columns therefore share label and value baselines even when one actor name wraps to two lines.

The workflow editor card keeps the terms `Worker` and `Critic`. New card-specific workflow locale keys provide those labels in both English and Simplified Chinese, and `CompactWorkerNode` reads them through `useT` instead of string literals.

## Testing

Focused tests will cover:

- split controls rendering without the repeated inner title;
- node configuration rendering without redundant actor summary guidance;
- shared canvas spacing for close nodes while preserving larger gaps and stage isolation;
- aligned metadata row classes in editor and runtime cards;
- locale-backed `Worker` and `Critic` labels in the editor card.

Verification is limited to the affected Vitest files, `@multica/views` typecheck, and browser screenshots of the two reported surfaces.
