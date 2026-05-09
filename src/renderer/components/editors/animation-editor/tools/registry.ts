import type { AnimationToolDefinition } from "./types";
import { createLineTool } from "./line";
import { createPencilTool } from "./pencil";
import { createRangeTool } from "./range";
import { createSmoothTool } from "./smooth";

const PLACEHOLDER_TOOLS: AnimationToolDefinition[] = [
  {
    id: "Clone",
    label: "Clone",
    section: "Sculpting",
    enabled: false,
    description: "Clone sample regions from a source and paint onto a target with falloff.",
  },
  {
    id: "Flatten",
    label: "Flatten",
    section: "Sculpting",
    enabled: false,
    description: "Collapse local variance toward a flatter profile.",
  },
  {
    id: "Push/Pull",
    label: "Push/Pull",
    section: "Sculpting",
    enabled: false,
    description: "Nudge values up or down without changing timing.",
  },
];

export function listAnimationTools(): AnimationToolDefinition[] {
  return [createPencilTool(), createLineTool(), createRangeTool(), ...PLACEHOLDER_TOOLS, createSmoothTool()];
}
