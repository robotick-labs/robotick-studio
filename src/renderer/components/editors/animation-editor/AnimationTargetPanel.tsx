import React from "react";

import { ActiveClipFieldMenu } from "./ActiveClipFieldMenu";
import { AnimSetFieldMenu } from "./AnimSetFieldMenu";
import type { AnimLoadStatus, ClipRef, SaveButtonPresentation } from "./anim-editor-shared";
import styles from "./AnimationEditorPage.module.css";

type AnimationTargetPanelProps = {
  animLoadStatus: AnimLoadStatus;
  animsetOptions: string[];
  animsetPath: string;
  applyAnimsetPath: (nextPath: string) => void;
  channelsetId: string;
  channelsetPath: string;
  clipRefs: ClipRef[];
  compatibleSources: Array<{ id: string; label: string }>;
  onCreateAnimset: () => void | Promise<void>;
  onCreateClip: () => void | Promise<void>;
  onDeleteAnimset: () => void | Promise<void>;
  onDeleteClip: () => void | Promise<void>;
  onDuplicateAnimset: () => void | Promise<void>;
  onDuplicateClip: () => void | Promise<void>;
  onReloadClipRefs: () => void | Promise<void>;
  onRenameAnimset: () => void | Promise<void>;
  onRenameClip: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  saveButtonUi: SaveButtonPresentation;
  selectedClipPath: string;
  selectedSourceId: string;
  setSelectedSourceId: (nextSourceId: string) => void;
  applyActiveClipPath: (nextPath: string) => void;
};

export function AnimationTargetPanel({
  animLoadStatus,
  animsetOptions,
  animsetPath,
  applyAnimsetPath,
  channelsetId,
  channelsetPath,
  clipRefs,
  compatibleSources,
  onCreateAnimset,
  onCreateClip,
  onDeleteAnimset,
  onDeleteClip,
  onDuplicateAnimset,
  onDuplicateClip,
  onReloadClipRefs,
  onRenameAnimset,
  onRenameClip,
  onSave,
  saveButtonUi,
  selectedClipPath,
  selectedSourceId,
  setSelectedSourceId,
  applyActiveClipPath,
}: AnimationTargetPanelProps) {
  return (
    <section className={styles.panelCard}>
      <div className={styles.toolButtons}>
        <button className={styles.toolButton} type="button" title="Auto-save is not implemented yet." disabled>
          Auto-save
        </button>
        <button
          className={[
            styles.toolButton,
            saveButtonUi.tone === "dirty" ? styles.toolButtonDirty : "",
            saveButtonUi.tone === "failed" ? styles.toolButtonFailed : "",
          ]
            .filter(Boolean)
            .join(" ")}
          type="button"
          title={saveButtonUi.title}
          onClick={() => void onSave()}
          disabled={saveButtonUi.disabled}
        >
          <span className={styles.saveButtonContent}>
            <span>{saveButtonUi.label}</span>
            {saveButtonUi.showDirtyDot ? <span className={styles.saveDirtyDot} aria-hidden="true" /> : null}
          </span>
        </button>
      </div>
      <div className={styles.sectionHeaderRow}>
        <h3>Target</h3>
        <span
          className={[
            styles.animStatusLed,
            animLoadStatus.level === "ok"
              ? styles.animStatusLedOk
              : animLoadStatus.level === "warning"
                ? styles.animStatusLedWarning
                : styles.animStatusLedError,
          ].join(" ")}
          title={`Anim Status: ${animLoadStatus.message}`}
          aria-label={`Anim status ${animLoadStatus.level}`}
        />
      </div>
      <select
        value={selectedSourceId}
        onChange={(event) => setSelectedSourceId(event.target.value)}
        className={styles.selectControl}
      >
        {compatibleSources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.label}
          </option>
        ))}
      </select>
      <h3>Channel Set</h3>
      <div
        className={`${styles.assetNameField} ${styles.assetNameFieldReadOnly}`}
        title={`Read-only: channel set is workload config-defined (${channelsetId || "unknown"})`}
        aria-readonly="true"
      >
        {`${channelsetPath.split("/").pop() || channelsetPath} (read-only)`}
      </div>
      <h3>Anim Set</h3>
      <AnimSetFieldMenu
        animsetOptions={animsetOptions}
        animsetPath={animsetPath}
        onSelectAnimsetPath={applyAnimsetPath}
        onCreate={onCreateAnimset}
        onDuplicate={onDuplicateAnimset}
        onRename={onRenameAnimset}
        onDelete={onDeleteAnimset}
      />
      <h3>Active Clip</h3>
      <ActiveClipFieldMenu
        clipRefs={clipRefs.map((clip) => ({ name: clip.name, animclipPath: clip.animclipPath }))}
        selectedClipPath={selectedClipPath}
        onReload={() => void onReloadClipRefs()}
        onSelectClipPath={applyActiveClipPath}
        onCreate={onCreateClip}
        onDuplicate={onDuplicateClip}
        onRename={onRenameClip}
        onDelete={onDeleteClip}
      />
    </section>
  );
}
