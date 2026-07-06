"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflowEditorStore } from "@multica/core/workflows/store";
import type { WorkflowNode as WorkflowNodeType, WorkflowEdge as WorkflowEdgeType, WorkflowStage } from "@multica/core/types";
import { parseNodeShape } from "@multica/core/types";
import {
  WorkflowNode as RFWorkflowNode,
  AnnotationNode,
  WorkflowEdge as RFWorkflowEdge,
  AnnotationConnectorEdge,
  NODE_WIDTH, NODE_HEIGHT, DIAMOND_SIZE, HEXAGON_SIZE,
  type WorkflowNodeData,
} from "./reactflow-nodes";
import { computeAlignmentSnap, type AlignmentGuide } from "./alignment-snap";

const nodeTypes = { workflow: RFWorkflowNode, annotation: AnnotationNode };
const edgeTypes = { workflow: RFWorkflowEdge, annotation: AnnotationConnectorEdge };

function parseNodeFormat(formatSchema: unknown) {
  const shape = parseNodeShape(formatSchema);
  let nodeColor: string | undefined;
  let fontSize: number | undefined;
  let nodeWidth: number | undefined;
  let nodeHeight: number | undefined;
  if (formatSchema && typeof formatSchema === "object" && formatSchema !== null) {
    const obj = formatSchema as Record<string, unknown>;
    if (typeof obj.color === "string" && obj.color !== "") nodeColor = obj.color;
    if (typeof obj.fontSize === "number") fontSize = obj.fontSize;
    if (typeof obj.width === "number") nodeWidth = obj.width;
    if (typeof obj.height === "number") nodeHeight = obj.height;
  }
  return { shape, nodeColor, fontSize, nodeWidth, nodeHeight };
}

function isAnnotationNode(fs: unknown): boolean {
  return Boolean(fs && typeof fs === "object" && !Array.isArray(fs) && (fs as Record<string, unknown>).type === "annotation");
}

export interface ReactFlowSurfaceProps {
  nodes: WorkflowNodeType[];
  edges: WorkflowEdgeType[];
  stages?: WorkflowStage[];
  onNodeDragStop?: (nodeId: string, x: number, y: number) => void;
  onEdgeCreate?: (sourceNodeId: string, targetNodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeCreate?: (type: string, x: number, y: number) => void;
  nodeStatusColors?: Record<string, string>;
  nodeStatuses?: Record<string, { status: string; isRunning: boolean; isAwaitingInput?: boolean }>;
  showMiniMap?: boolean;
}

export function ReactFlowSurface({
  nodes,
  edges,
  onNodeDragStop,
  onEdgeCreate,
  onEdgeDelete,
  onNodeClick,
  onNodeCreate,
  nodeStatusColors,
  nodeStatuses,
  showMiniMap = false,
}: ReactFlowSurfaceProps) {
  const mode = useWorkflowEditorStore((s) => s.mode);
  const selectNode = useWorkflowEditorStore((s) => s.selectNode);
  const selectEdge = useWorkflowEditorStore((s) => s.selectEdge);
  const setSelectedNodeIds = useWorkflowEditorStore((s) => s.setSelectedNodeIds);
  const cacheNodeDelete = useWorkflowEditorStore((s) => s.cacheNodeDelete);
  const deletedNodeIds = useWorkflowEditorStore((s) => s.deletedNodeIds);
  const canvasColorMode = useWorkflowEditorStore((s) => s.canvasColorMode);
  const { screenToFlowPosition } = useReactFlow();
  const cacheNodeEdit = useWorkflowEditorStore((s) => s.cacheNodeEdits);

  // Build ReactFlow nodes from props
  const propNodes: Node<WorkflowNodeData>[] = useMemo(() => {
    return nodes
      .filter((n) => !deletedNodeIds.includes(n.id))
      .filter((n) => !isAnnotationNode(n.format_schema))
      .map((n) => {
        const { shape, nodeColor, fontSize, nodeWidth, nodeHeight } = parseNodeFormat(n.format_schema);
        return {
          id: n.id,
          type: isAnnotationNode(n.format_schema) ? "annotation" as const : "workflow" as const,
          position: { x: n.position_x, y: n.position_y },
          zIndex: isAnnotationNode(n.format_schema) ? -1 : 0,
          width: nodeWidth ?? (shape === "diamond" ? DIAMOND_SIZE : shape === "hexagon" ? HEXAGON_SIZE : NODE_WIDTH),
          height: nodeHeight ?? (shape === "diamond" || shape === "hexagon" ? (shape === "diamond" ? DIAMOND_SIZE : HEXAGON_SIZE) : NODE_HEIGHT),
          data: {
            title: n.title,
            statusColor: nodeStatusColors?.[n.id],
            statusLabel: nodeStatuses?.[n.id]?.status,
            isRunning: nodeStatuses?.[n.id]?.isRunning ?? false,
            isAwaitingInput: nodeStatuses?.[n.id]?.isAwaitingInput ?? false,
            isEditing: mode !== "view",
            shape,
            nodeColor,
            fontSize,
            onNodeSelect: (id: string) => { selectNode(id); onNodeClick?.(id); },
            onNodeResizeStart: () => {},
            onNodeResizeEnd: (id: string, w: number, h: number) => {
              const n = nodes.find((x) => x.id === id);
              if (!n) return;
              const parsed = n.format_schema && typeof n.format_schema === "object" && !Array.isArray(n.format_schema)
                ? { ...(n.format_schema as Record<string, unknown>) } : {};
              parsed.width = Math.round(w);
              parsed.height = Math.round(h);
              cacheNodeEdit(id, { format_schema: parsed });
            },
          },
        };
      });
  }, [nodes, nodeStatusColors, nodeStatuses, deletedNodeIds, mode, selectNode, onNodeClick, cacheNodeEdit]);

  // Local state for ReactFlow rendering
  const [rfNodes, setRfNodes] = useState(propNodes);
  const draggingRef = useRef(false);
  const rfNodesRef = useRef(rfNodes);
  rfNodesRef.current = rfNodes;
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [shouldFitView, setShouldFitView] = useState(true);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShouldFitView(false));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (draggingRef.current) return;
    setRfNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const nextMap = new Map(propNodes.map((n) => [n.id, n]));
      const result: Node<WorkflowNodeData>[] = [];
      for (const [id, nextNode] of nextMap) {
        const prevNode = prevMap.get(id);
        result.push(prevNode ? { ...prevNode, data: nextNode.data } : nextNode);
      }
      return result;
    });
  }, [propNodes]);

  // Edge handle pair resolution (same logic as existing dag-canvas)
  const handlePairs = useMemo(() => {
    const posMap = new Map(nodes.map((n) => [n.id, { x: n.position_x, y: n.position_y }]));
    return new Map<string, { sourceHandle: string; targetHandle: string }>(
      edges.map((e) => {
        const src = posMap.get(e.source_node_id);
        const tgt = posMap.get(e.target_node_id);
        if (!src || !tgt) return [e.id, { sourceHandle: "bottom", targetHandle: "top" }];
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        return [e.id, {
          sourceHandle: Math.abs(dx) > Math.abs(dy) ? "right" as const : "bottom" as const,
          targetHandle: Math.abs(dx) > Math.abs(dy) ? "left" as const : "top" as const,
        }];
      }),
    );
  }, [nodes, edges]);

  const propEdges: Edge[] = useMemo(() => {
    const base = edges.map((e) => ({
      id: e.id, type: "workflow" as const,
      source: e.source_node_id, target: e.target_node_id,
      sourceHandle: handlePairs.get(e.id)?.sourceHandle ?? "bottom",
      targetHandle: handlePairs.get(e.id)?.targetHandle ?? "top",
      data: { onEdgeDelete },
      markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--muted-foreground))" },
      interactionWidth: 20,
    }));
    // Annotation connector edges
    const annoEdges: Edge[] = [];
    for (const n of nodes) {
      if (!isAnnotationNode(n.format_schema)) continue;
      const fs = n.format_schema as Record<string, unknown> | null;
      const targetId = fs?.annotation_target_node_id as string | undefined;
      if (!targetId) continue;
      const target = nodes.find((t) => t.id === targetId && !isAnnotationNode(t.format_schema));
      if (!target) continue;
      annoEdges.push({ id: `anno-link-${n.id}`, type: "annotation" as const, source: n.id, target: targetId, sourceHandle: "anno-right", targetHandle: "left", hidden: false });
    }
    return [...base, ...annoEdges];
  }, [edges, onEdgeDelete, handlePairs, nodes]);

  const [rfEdges, setRfEdges] = useState(propEdges);
  useEffect(() => {
    setRfEdges((currentEdges) => {
      const stateByKey = new Map(currentEdges.map((e) => [e.id, { selected: e.selected }] as const));
      return propEdges.map((e) => {
        const existing = stateByKey.get(e.id);
        return existing ? { ...e, selected: existing.selected } : e;
      });
    });
  }, [propEdges]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => setSelectedNodeIds(selectedNodes.map((n) => n.id)),
    [setSelectedNodeIds],
  );

  const handleNodeDragStart = useCallback(() => { draggingRef.current = true; }, []);
  const handleNodeDragStopHandler = useCallback(
    (_: MouseEvent | TouchEvent, node: Node) => {
      draggingRef.current = false;
      setAlignmentGuides([]);
      const ids = useWorkflowEditorStore.getState().selectedNodeIds;
      if (ids.length > 1) {
        for (const id of ids) {
          const current = rfNodesRef.current.find((n) => n.id === id);
          if (current) onNodeDragStop?.(id, Math.round(current.position.x), Math.round(current.position.y));
        }
      } else {
        const current = rfNodesRef.current.find((n) => n.id === node.id);
        onNodeDragStop?.(node.id, Math.round(current?.position.x ?? node.position.x), Math.round(current?.position.y ?? node.position.y));
      }
    },
    [onNodeDragStop],
  );

  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    let guides: AlignmentGuide[] = [];
    for (const change of changes) {
      if (change.type === "remove") cacheNodeDelete(change.id);
    }
    let snapDeltaX = 0, snapDeltaY = 0, firstSnapped = false;
    const snappedChanges = changes.map((change) => {
      if (change.type === "position" && change.dragging && change.position) {
        if (!firstSnapped) {
          const result = computeAlignmentSnap(change.id, change.position.x, change.position.y, rfNodesRef.current);
          guides.push(...result.guides);
          snapDeltaX = result.x - change.position.x;
          snapDeltaY = result.y - change.position.y;
          firstSnapped = true;
          return { ...change, position: { x: result.x, y: result.y } };
        }
        return { ...change, position: { x: change.position.x + snapDeltaX, y: change.position.y + snapDeltaY } };
      }
      return change;
    });
    setAlignmentGuides(guides);
    setRfNodes((nds) => { const next = applyNodeChanges(snappedChanges, nds) as Node<WorkflowNodeData>[]; rfNodesRef.current = next; return next; });
  }, [cacheNodeDelete]);

  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    for (const change of changes) {
      if (change.type === "remove" && mode !== "view") onEdgeDelete?.(change.id);
    }
    setRfEdges((eds) => applyEdgeChanges(changes, eds));
  }, [onEdgeDelete, mode]);

  const handleConnect = useCallback((conn: Connection) => {
    if (conn.source && conn.target) onEdgeCreate?.(conn.source, conn.target);
  }, [onEdgeCreate]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => selectEdge(edge.id), [selectEdge]);
  const handlePaneClick = useCallback(() => { selectNode(null); selectEdge(null); setSelectedNodeIds([]); }, [selectNode, selectEdge, setSelectedNodeIds]);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dragType = e.dataTransfer.getData("application/x-multica-shape");
    if (!dragType) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onNodeCreate?.(dragType, pos.x, pos.y);
  }, [screenToFlowPosition, onNodeCreate]);

  // MiniMap node colors
  const miniMapNodeColors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      const { nodeColor } = parseNodeFormat(n.format_schema);
      if (nodeColor) map[n.id] = nodeColor;
    }
    return map;
  }, [nodes]);

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="text-3xl opacity-30">+</div>
          <p className="text-sm text-muted-foreground">Add your first step</p>
          <p className="text-xs text-muted-foreground/60">Drag a node from the panel or click + to start</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_e, node) => { selectNode(node.id); selectEdge(null); onNodeClick?.(node.id); }}
      onNodeDragStart={handleNodeDragStart}
      onNodeDragStop={handleNodeDragStopHandler}
      onNodesChange={handleNodesChange}
      onConnect={handleConnect}
      onEdgeClick={handleEdgeClick}
      onEdgesChange={handleEdgesChange}
      onPaneClick={handlePaneClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onSelectionChange={handleSelectionChange}
      selectionOnDrag={mode !== "view"}
      multiSelectionKeyCode="Shift"
      deleteKeyCode={mode !== "view" ? "Backspace" : null}
      connectionMode={ConnectionMode.Loose}
      nodesDraggable={mode !== "view"}
      nodesConnectable={mode !== "view"}
      nodesFocusable
      elementsSelectable
      fitView={shouldFitView}
      colorMode={canvasColorMode}
    >
      <Background color="var(--muted-foreground)" gap={24} size={1.5} />
      <Controls className="[&>button]:bg-card [&>button]:border-border" />
      {showMiniMap && <MiniMap nodeColor={(node) => miniMapNodeColors[node.id] ?? "#e2e8f0"} />}
      {alignmentGuides.length > 0 && (
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", zIndex: 10 }}>
          {alignmentGuides.map((g, i) => (
            <line key={i} x1={g.orientation === "vertical" ? g.position : g.start} y1={g.orientation === "vertical" ? g.start : g.position} x2={g.orientation === "vertical" ? g.position : g.end} y2={g.orientation === "vertical" ? g.end : g.position} stroke="var(--primary)" strokeWidth={1} strokeDasharray="4 2" />
          ))}
        </svg>
      )}
    </ReactFlow>
  );
}
