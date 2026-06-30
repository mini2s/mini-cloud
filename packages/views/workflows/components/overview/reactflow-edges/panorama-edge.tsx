import { BaseEdge, getStraightPath, type EdgeProps } from "@xyflow/react";

export function PanoramaEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const isDashed = style?.strokeDasharray !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          strokeWidth: 1.5,
          opacity: 0.35,
          ...style,
        }}
        markerEnd={markerEnd}
      />
      {selected && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            strokeWidth: 4,
            opacity: 0.2,
            stroke: "#3b82f6",
            strokeDasharray: isDashed ? style?.strokeDasharray : undefined,
          }}
        />
      )}
    </>
  );
}
