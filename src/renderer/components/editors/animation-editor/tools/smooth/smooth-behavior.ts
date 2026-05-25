import type { AnimationDocumentMutations } from "../document";

export const smoothBehaviorId = "smooth-behavior-v2";

export function handleSmoothBrushPreviewBehavior(args: {
  activeTool: "Pencil" | "Line" | "Range" | "Warp" | "Smooth" | null;
  channel: string;
  timeSec: number | null;
  durationSec: number;
  mutations: Pick<AnimationDocumentMutations, "setSmoothBrushPreview">;
}) {
  const { activeTool, channel, timeSec, durationSec, mutations } = args;
  if (activeTool !== "Smooth") return;
  if (timeSec === null) {
    mutations.setSmoothBrushPreview(null);
    return;
  }
  mutations.setSmoothBrushPreview({
    channel,
    centerSec: Math.min(durationSec, Math.max(0, timeSec)),
  });
}
