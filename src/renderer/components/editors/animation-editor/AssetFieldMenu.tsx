import React from "react";
import { createPortal } from "react-dom";
import styles from "./AnimationEditorPage.module.css";

export type AssetMenuItem = {
  key: string;
  label: string;
  title?: string;
};

type AssetMenuAction = {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
};

type Props = {
  valueLabel: string;
  valueTitle?: string;
  menuButtonTitle: string;
  filterPlaceholder: string;
  listAriaLabel: string;
  actionAriaLabel: string;
  items: AssetMenuItem[];
  selectedKey: string;
  highlightedKey?: string;
  onHighlightKey?: (key: string) => void;
  onActivateKey?: (key: string) => void;
  onOpen?: () => void;
  actions: AssetMenuAction[];
  renderItemControl?: (item: AssetMenuItem) => React.ReactNode;
};

export function AssetFieldMenu({
  valueLabel,
  valueTitle,
  menuButtonTitle,
  filterPlaceholder,
  listAriaLabel,
  actionAriaLabel,
  items,
  selectedKey,
  highlightedKey,
  onHighlightKey,
  onActivateKey,
  onOpen,
  actions,
  renderItemControl,
}: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [menuPos, setMenuPos] = React.useState<{ top: number; left: number } | null>(null);
  const [localHighlightedKey, setLocalHighlightedKey] = React.useState<string>(selectedKey);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);

  const effectiveHighlightedKey = highlightedKey ?? localHighlightedKey;

  const filteredItems = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q) || item.key.toLowerCase().includes(q));
  }, [filter, items]);

  React.useEffect(() => {
    if (!menuOpen) return;

    const updateMenuPosition = () => {
      const buttonEl = menuButtonRef.current;
      if (!buttonEl) return;
      const rect = buttonEl.getBoundingClientRect();
      const panelWidth = 258;
      const horizontalGap = 6;

      let left = rect.right + horizontalGap;
      if (left + panelWidth > window.innerWidth - 8) {
        left = Math.max(8, rect.left - horizontalGap - panelWidth);
      }

      const top = Math.max(8, rect.top);
      setMenuPos({ top, left });
    };

    updateMenuPosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setMenuOpen(false);
      setFilter("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setFilter("");
    };
    const onWindowResize = () => updateMenuPosition();
    const onWindowScroll = () => updateMenuPosition();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onWindowScroll, true);
    };
  }, [menuOpen]);

  const setHighlighted = (key: string) => {
    setLocalHighlightedKey(key);
    onHighlightKey?.(key);
  };

  const activate = (key: string) => {
    onActivateKey?.(key);
  };

  return (
    <div className={styles.assetFieldRow} ref={menuRef}>
      <div className={styles.assetNameField} title={valueTitle ?? valueLabel}>{valueLabel}</div>
      <button
        ref={menuButtonRef}
        className={styles.assetMenuButton}
        type="button"
        title={menuButtonTitle}
        aria-label={menuButtonTitle}
        onClick={() => {
          onOpen?.();
          setMenuOpen((open) => {
            const next = !open;
            if (next) setHighlighted(selectedKey);
            return next;
          });
          setFilter("");
        }}
      >
        ...
      </button>
      {menuOpen && menuPos
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.assetMenuPopover}
              style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
            >
              <div className={styles.assetSelectPanel}>
                <input
                  className={styles.assetSelectInput}
                  type="text"
                  placeholder={filterPlaceholder}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  autoFocus
                />
                <div className={styles.assetSelectList} role="menu" aria-label={listAriaLabel}>
                  {filteredItems.map((item) => {
                    const isHighlighted = item.key === effectiveHighlightedKey;
                    return (
                      <div
                        key={item.key}
                        className={`${styles.assetClipRow} ${isHighlighted ? styles.assetClipRowSelected : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setHighlighted(item.key)}
                        onDoubleClick={() => activate(item.key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setHighlighted(item.key);
                          }
                        }}
                        title={item.title ?? item.key}
                      >
                        <span className={styles.assetClipSelectLabel}>{item.label}</span>
                        {renderItemControl ? renderItemControl(item) : <span />}
                      </div>
                    );
                  })}
                </div>
                <div className={styles.assetMenuDivider} />
                <div className={styles.assetActionBar} role="menu" aria-label={actionAriaLabel}>
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      className={styles.assetActionStdButton}
                      type="button"
                      disabled={action.disabled}
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
