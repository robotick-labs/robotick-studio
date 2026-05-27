import React from "react";

import {
  labelFromAssetPath,
  saveButtonPresentation,
  type AnimAuthoringActionResponse,
  type AnimLoadStatusLevel,
  type AnimSaveResponse,
  type ClipData,
  type ClipRef,
} from "../anim-editor-shared";

type UseAnimAuthoringActionsArgs = {
  animsetPath: string;
  clipDirty: boolean;
  clipDataRef: React.RefObject<ClipData>;
  durationSec: number;
  selectedClipIndex: number;
  selectedClipRef: ClipRef | null;
  applyAnimsetPath: (nextPath: string) => void;
  applyActiveClipPath: (nextPath: string) => void;
  loadLiveClipData: (clipIndex: number, clipName?: string) => Promise<ClipData | null>;
  performAnimAuthoringAction: (suffix: string, body: Record<string, unknown>) => Promise<AnimAuthoringActionResponse>;
  performAnimSave: () => Promise<AnimSaveResponse>;
  reloadAnimsetClipRefs: () => Promise<void>;
  reportAnimLoadStatus: (level: AnimLoadStatusLevel, message: string) => void;
};

export function useAnimAuthoringActions({
  animsetPath,
  clipDirty,
  clipDataRef,
  durationSec,
  selectedClipIndex,
  selectedClipRef,
  applyAnimsetPath,
  applyActiveClipPath,
  loadLiveClipData,
  performAnimAuthoringAction,
  performAnimSave,
  reloadAnimsetClipRefs,
  reportAnimLoadStatus,
}: UseAnimAuthoringActionsArgs) {
  const [saveStatus, setSaveStatus] = React.useState<"clean" | "dirty" | "saving" | "failed">("clean");

  React.useEffect(() => {
    setSaveStatus((current) => {
      if (current === "saving") return current;
      if (current === "failed" && clipDirty) return current;
      return clipDirty ? "dirty" : "clean";
    });
  }, [clipDirty]);

  const handleCreateAnimset = React.useCallback(async () => {
    const proposed = window.prompt("New Anim Set name", "new_animset");
    if (!proposed) return;
    try {
      const payload = await performAnimAuthoringAction("/animset-create", { animset_name: proposed });
      await reloadAnimsetClipRefs();
      if (payload.animset_path) {
        applyAnimsetPath(payload.animset_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to create Anim Set.");
    }
  }, [applyAnimsetPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  const handleDuplicateAnimset = React.useCallback(async () => {
    if (!animsetPath) return;
    const proposed = window.prompt("Duplicate Anim Set as", `${labelFromAssetPath(animsetPath, ".animset.yaml")}_copy`);
    if (!proposed) return;
    try {
      const payload = await performAnimAuthoringAction("/animset-duplicate", {
        source_animset_path: animsetPath,
        animset_name: proposed,
      });
      await reloadAnimsetClipRefs();
      if (payload.animset_path) {
        applyAnimsetPath(payload.animset_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to duplicate Anim Set.");
    }
  }, [animsetPath, applyAnimsetPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  const handleRenameAnimset = React.useCallback(async () => {
    if (!animsetPath) return;
    const currentName = labelFromAssetPath(animsetPath, ".animset.yaml");
    const proposed = window.prompt("Rename Anim Set", currentName);
    if (!proposed || proposed === currentName) return;
    try {
      await performAnimAuthoringAction("/animset-rename", {
        source_animset_path: animsetPath,
        animset_name: proposed,
      });
      await reloadAnimsetClipRefs();
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to rename Anim Set.");
    }
  }, [animsetPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  const handleDeleteAnimset = React.useCallback(async () => {
    if (!animsetPath) return;
    if (!window.confirm(`Remove Anim Set '${labelFromAssetPath(animsetPath, ".animset.yaml")}' from the anim project?`)) return;
    try {
      const payload = await performAnimAuthoringAction("/animset-delete", { source_animset_path: animsetPath });
      await reloadAnimsetClipRefs();
      if (payload.animset_path) {
        applyAnimsetPath(payload.animset_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to remove Anim Set.");
    }
  }, [animsetPath, applyAnimsetPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  const handleCreateClip = React.useCallback(async () => {
    const proposed = window.prompt("New Clip name", "new_clip");
    if (!proposed) return;
    try {
      const payload = await performAnimAuthoringAction("/clip-create", { clip_name: proposed });
      await reloadAnimsetClipRefs();
      if (payload.clip_identity?.animclip_path) {
        applyActiveClipPath(payload.clip_identity.animclip_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to create clip.");
    }
  }, [applyActiveClipPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus]);

  const handleDuplicateClip = React.useCallback(async () => {
    if (selectedClipIndex < 0 || !selectedClipRef) return;
    const proposed = window.prompt("Duplicate Clip as", `${selectedClipRef.name}_copy`);
    if (!proposed) return;
    try {
      const payload = await performAnimAuthoringAction("/clip-duplicate", {
        clip_index: selectedClipIndex,
        clip_name: proposed,
      });
      await reloadAnimsetClipRefs();
      if (payload.clip_identity?.animclip_path) {
        applyActiveClipPath(payload.clip_identity.animclip_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to duplicate clip.");
    }
  }, [applyActiveClipPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipIndex, selectedClipRef]);

  const handleRenameClip = React.useCallback(async () => {
    if (selectedClipIndex < 0 || !selectedClipRef) return;
    const proposed = window.prompt("Rename Clip", selectedClipRef.name);
    if (!proposed || proposed === selectedClipRef.name) return;
    try {
      await performAnimAuthoringAction("/clip-rename", {
        clip_index: selectedClipIndex,
        clip_name: proposed,
      });
      await reloadAnimsetClipRefs();
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to rename clip.");
    }
  }, [performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipIndex, selectedClipRef]);

  const handleDeleteClip = React.useCallback(async () => {
    if (selectedClipIndex < 0 || !selectedClipRef) return;
    if (!window.confirm(`Remove clip '${selectedClipRef.name}' from the current Anim Set?`)) return;
    try {
      const payload = await performAnimAuthoringAction("/clip-delete", { clip_index: selectedClipIndex });
      await reloadAnimsetClipRefs();
      if (payload.clip_identity?.animclip_path) {
        applyActiveClipPath(payload.clip_identity.animclip_path);
      }
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to remove clip.");
    }
  }, [applyActiveClipPath, performAnimAuthoringAction, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipIndex, selectedClipRef]);

  const handleCommitDurationSec = React.useCallback(async (nextDurationSec: number) => {
    if (selectedClipIndex < 0) return;
    const allowCrop =
      nextDurationSec + 1e-6 < durationSec
        ? window.confirm(`Shorten clip from ${durationSec.toFixed(2)}s to ${nextDurationSec.toFixed(2)}s and crop trailing samples?`)
        : false;
    if (nextDurationSec + 1e-6 < durationSec && !allowCrop) {
      return;
    }
    try {
      await performAnimAuthoringAction("/clip-duration", {
        clip_index: selectedClipIndex,
        duration_sec: nextDurationSec,
        allow_crop: allowCrop,
      });
      await loadLiveClipData(selectedClipIndex, selectedClipRef?.name);
      await reloadAnimsetClipRefs();
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to update clip duration.");
    }
  }, [
    durationSec,
    loadLiveClipData,
    performAnimAuthoringAction,
    reloadAnimsetClipRefs,
    reportAnimLoadStatus,
    selectedClipIndex,
    selectedClipRef?.name,
  ]);

  const handleCommitLoopResetDurationSec = React.useCallback(async (nextLoopResetDurationSec: number) => {
    if (selectedClipIndex < 0) return;
    try {
      await performAnimAuthoringAction("/clip-loop-reset-duration", {
        clip_index: selectedClipIndex,
        loop_reset_duration_sec: nextLoopResetDurationSec,
      });
      await loadLiveClipData(selectedClipIndex, selectedClipRef?.name);
      await reloadAnimsetClipRefs();
    } catch (error) {
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to update loop reset duration.");
    }
  }, [
    loadLiveClipData,
    performAnimAuthoringAction,
    reloadAnimsetClipRefs,
    reportAnimLoadStatus,
    selectedClipIndex,
    selectedClipRef?.name,
  ]);

  const handleSave = React.useCallback(async () => {
    if (!clipDataRef.current.dirty) {
      setSaveStatus("clean");
      return;
    }
    setSaveStatus("saving");
    try {
      const payload = await performAnimSave();
      if (selectedClipIndex >= 0) {
        await loadLiveClipData(selectedClipIndex, selectedClipRef?.name);
      }
      await reloadAnimsetClipRefs();
      setSaveStatus(payload.dirty ? "dirty" : "clean");
      reportAnimLoadStatus("ok", payload.saved_clip_count && payload.saved_clip_count > 0 ? "Save complete." : "Nothing to save.");
    } catch (error) {
      setSaveStatus("failed");
      reportAnimLoadStatus("error", error instanceof Error ? error.message : "Failed to save animation changes.");
    }
  }, [clipDataRef, loadLiveClipData, performAnimSave, reloadAnimsetClipRefs, reportAnimLoadStatus, selectedClipIndex, selectedClipRef?.name]);

  return {
    handleCommitDurationSec,
    handleCommitLoopResetDurationSec,
    handleCreateAnimset,
    handleCreateClip,
    handleDeleteAnimset,
    handleDeleteClip,
    handleDuplicateAnimset,
    handleDuplicateClip,
    handleRenameAnimset,
    handleRenameClip,
    handleSave,
    saveButtonUi: saveButtonPresentation(clipDirty, saveStatus),
  };
}
