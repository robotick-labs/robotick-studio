export const pencilBehaviorId = "pencil-behavior-v2";

import type { AnimationDocumentMutations } from "../document";

export function handleLaneSelectBehavior(
  channel: string,
  mutations: Pick<AnimationDocumentMutations, "setSelectedChannel">
) {
  mutations.setSelectedChannel(channel);
}

export function handleLaneHoverBehavior(
  channel: string,
  hovered: boolean,
  mutations: Pick<AnimationDocumentMutations, "setHoveredChannel">
) {
  if (hovered) {
    mutations.setHoveredChannel(() => channel);
    return;
  }
  mutations.setHoveredChannel((prev) => (prev === channel ? null : prev));
}
