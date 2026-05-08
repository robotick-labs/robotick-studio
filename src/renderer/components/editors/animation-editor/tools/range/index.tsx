import type { AnimationToolDefinition } from "../types";
import { rangeBehaviorId } from "./range-behavior";
import { RangeSettingsPanel } from "./RangeSettingsPanel";

export function createRangeTool(): AnimationToolDefinition {
  return {
    id: "Range",
    label: "Range",
    section: "Sculpting",
    enabled: true,
    description:
      "Select a time range in the ruler, then offset that span per channel with the handle. [ / ] adjust size, Shift+[ / ] adjust falloff.",
    renderSettings: (context) => <RangeSettingsPanel {...context} />,
  };
}

export { rangeBehaviorId };
