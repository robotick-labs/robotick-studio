import type { AnimationToolDefinition } from "./types";
import { createLineTool } from "./line";
import { createPencilTool } from "./pencil";
import { createRangeTool } from "./range";
import { createSmoothTool } from "./smooth";
import { createWarpTool } from "./warp";

const PLACEHOLDER_TOOLS: AnimationToolDefinition[] = [
  {
    id: "Clone",
    label: "Clone",
    section: "Sculpting",
    enabled: false,
    description: "Clone sample regions from a source and paint onto a target with falloff.",
  },
];

export function listAnimationTools(): AnimationToolDefinition[] {
  return [createPencilTool(), createLineTool(), createRangeTool(), createWarpTool(), ...PLACEHOLDER_TOOLS, createSmoothTool()];
}
