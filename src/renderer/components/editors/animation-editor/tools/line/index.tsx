import type { AnimationToolDefinition } from "../types";
import { lineBehaviorId } from "./line-behavior";
import { LineSettingsPanel } from "./LineSettingsPanel";

export function createLineTool(): AnimationToolDefinition {
  return {
    id: "Line",
    label: "Line",
    section: "Sculpting",
    enabled: true,
    description:
      "Preview and place a straight line across a sample range. Esc cancels; mouse-up applies.",
    renderSettings: (context) => <LineSettingsPanel {...context} />,
  };
}

export { lineBehaviorId };
