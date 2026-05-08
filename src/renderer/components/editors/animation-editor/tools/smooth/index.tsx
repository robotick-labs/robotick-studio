import type { AnimationToolDefinition } from "../types";
import { smoothBehaviorId } from "./smooth-behavior";
import { SmoothSettingsPanel } from "./SmoothSettingsPanel";

export function createSmoothTool(): AnimationToolDefinition {
  return {
    id: "Smooth",
    label: "Smooth",
    section: "Sculpting",
    enabled: true,
    description:
      "Brush over the curve to smooth it locally. [ / ] adjust size, Shift+[ / ] adjust falloff, + / - adjust strength.",
    renderSettings: (context) => <SmoothSettingsPanel {...context} />,
  };
}

export { smoothBehaviorId };
