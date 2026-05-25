import type { AnimationToolDefinition } from "../types";
import { WarpSettingsPanel } from "./WarpSettingsPanel";

export function createWarpTool(): AnimationToolDefinition {
  return {
    id: "Warp",
    label: "Warp",
    section: "Sculpting",
    enabled: true,
    description:
      "Warp a selected region in time, value, or both by dragging its lane handle. Use the ruler to define the region first.",
    renderSettings: (context) => <WarpSettingsPanel {...context} />,
  };
}
