export type TimeSelectionRange = { startSec: number; endSec: number };

export type AnimationDocumentMutations = {
  setSelectedChannel: (channel: string) => void;
  setHoveredChannel: (updater: (prev: string | null) => string | null) => void;
  setSelectedTimeRange: (next: TimeSelectionRange | null) => void;
  setSmoothBrushPreview: (next: { channel: string; centerSec: number } | null) => void;
};
