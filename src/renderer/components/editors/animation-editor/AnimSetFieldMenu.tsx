import React from "react";
import styles from "./AnimationEditorPage.module.css";
import { AssetFieldMenu } from "./AssetFieldMenu";

type Props = {
  animsetOptions: string[];
  animsetPath: string;
  onSelectAnimsetPath: (nextPath: string) => void;
};

function labelFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function AnimSetFieldMenu({ animsetOptions, animsetPath, onSelectAnimsetPath }: Props) {
  const selectedLabel = React.useMemo(() => labelFromPath(animsetPath), [animsetPath]);

  return (
    <AssetFieldMenu
      valueLabel={selectedLabel}
      valueTitle={animsetPath}
      menuButtonTitle="AnimSet actions"
      filterPlaceholder="Filter animsets..."
      listAriaLabel="AnimSet list"
      actionAriaLabel="AnimSet actions"
      items={animsetOptions.map((path) => ({ key: path, label: labelFromPath(path), title: path }))}
      selectedKey={animsetPath}
      onActivateKey={onSelectAnimsetPath}
      renderItemControl={(item) => {
        const isActive = item.key === animsetPath;
        return (
          <button
            className={`${styles.eyeToggle} ${isActive ? styles.eyeToggleActive : ""}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelectAnimsetPath(item.key);
            }}
            title={isActive ? "Active animset" : "Set active animset"}
            aria-label={isActive ? "Active animset" : "Set active animset"}
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
