import React from "react";
import styles from "./AnimationEditorPage.module.css";
import { AssetFieldMenu } from "./AssetFieldMenu";

type ClipRef = { name: string; animclipPath: string };

type Props = {
  clipRefs: ClipRef[];
  selectedClipPath: string;
  onReload: () => void;
  onSelectClipPath: (nextPath: string) => void;
};

export function ActiveClipFieldMenu({ clipRefs, selectedClipPath, onReload, onSelectClipPath }: Props) {
  const selectedClipName = React.useMemo(
    () => clipRefs.find((clip) => clip.animclipPath === selectedClipPath)?.name ?? "None",
    [clipRefs, selectedClipPath]
  );

  return (
    <AssetFieldMenu
      valueLabel={selectedClipName}
      valueTitle={selectedClipName}
      menuButtonTitle="Active clip actions"
      filterPlaceholder="Filter clips..."
      listAriaLabel="Active clip list"
      actionAriaLabel="Active clip actions"
      items={clipRefs.map((clip) => ({ key: clip.animclipPath, label: clip.name, title: clip.animclipPath }))}
      selectedKey={selectedClipPath}
      onOpen={onReload}
      onActivateKey={onSelectClipPath}
      renderItemControl={(item) => {
        const isActive = item.key === selectedClipPath;
        return (
          <button
            className={`${styles.eyeToggle} ${isActive ? styles.eyeToggleActive : ""}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelectClipPath(item.key);
            }}
            title={isActive ? "Active clip" : "Set active clip"}
            aria-label={isActive ? "Active clip" : "Set active clip"}
          >
            👁
          </button>
        );
      }}
      actions={[
        { label: "New", disabled: true },
        { label: "Duplicate", disabled: true },
        { label: "Rename", disabled: true },
        { label: "Delete", disabled: true },
      ]}
    />
  );
}
