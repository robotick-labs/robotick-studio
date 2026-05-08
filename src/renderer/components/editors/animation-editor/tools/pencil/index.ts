import type { AnimationToolDefinition } from "../types";
import { pencilBehaviorId } from "./pencil-behavior";

export function createPencilTool(): AnimationToolDefinition {
  return {
    id: "Pencil",
    label: "Pencil",
    section: "Sculpting",
    enabled: true,
    description: "Paint values freely across a time window toward the cursor path.",
  };
}

export { pencilBehaviorId };
