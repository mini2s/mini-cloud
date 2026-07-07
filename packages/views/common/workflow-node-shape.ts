import type { NodeShape } from "@multica/core/types";

export function workflowNodeShapeSurfaceClassName(shape: NodeShape): string {
  switch (shape) {
    case "pill":
      return "rounded-full";
    case "diamond":
    case "hexagon":
    case "rectangle":
      return "rounded-lg";
  }
}

export function workflowNodeInfoAreaClassName(shape: NodeShape): string {
  switch (shape) {
    case "diamond":
      return "px-10 py-3";
    case "hexagon":
      return "px-6 py-2.5";
    case "pill":
      return "px-5 py-2.5";
    case "rectangle":
      return "px-2.5 py-2";
  }
}

export function workflowNodeShapeGlyphClassName(shape: NodeShape): string {
  switch (shape) {
    case "diamond":
      return "rotate-45 rounded-[2px]";
    case "hexagon":
      return "[clip-path:polygon(18%_0%,82%_0%,100%_50%,82%_100%,18%_100%,0%_50%)]";
    case "pill":
      return "rounded-full";
    case "rectangle":
      return "rounded-sm";
  }
}
