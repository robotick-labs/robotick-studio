import React from "react";
import styles from "./AnimationEditorPage.module.css";
import { AssetFieldMenu } from "./AssetFieldMenu";

type Props = {
  animsetOptions: string[];
  animsetPath: string;
  onSelectAnimsetPath: (nextPath: string) => void;
  onCreate?: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
};

function labelFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export function AnimSetFieldMenu({ animsetOptions, animsetPath, onSelectAnimsetPath, onCreate, onDuplicate, onRename, onDelete }: Props) {
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
        { label: "New", disabled: !onCreate, onClick: onCreate },
        { label: "Duplicate", disabled: !onDuplicate || !animsetPath, onClick: onDuplicate },
        { label: "Rename", disabled: !onRename || !animsetPath, onClick: onRename },
        { label: "Delete", disabled: !onDelete || !animsetPath, onClick: onDelete },
      ]}
    />
  );
}
