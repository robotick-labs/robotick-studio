import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./GenericPanel.module.css";

type Vec2 = { x: number; y: number };
type Size = { width: number; height: number };

export type GenericPanelProps = {
  title?: React.ReactNode;
  children: React.ReactNode;
  initialPosition?: Vec2;
  initialSize?: Size;
  minSize?: Size;
  draggable?: boolean;
  resizable?: boolean;
  closable?: boolean;
  onClose?: () => void;
  modal?: boolean;
  onBackdropClick?: () => void;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  headerActions?: React.ReactNode;
  style?: React.CSSProperties;
  storageKey?: string;
};

const DEFAULT_POSITION: Vec2 = { x: 160, y: 160 };
const DEFAULT_SIZE: Size = { width: 520, height: 360 };
const DEFAULT_MIN_SIZE: Size = { width: 260, height: 180 };
const STORAGE_PREFIX = "generic-panel:";

export function GenericPanel({
  title,
  children,
  initialPosition = DEFAULT_POSITION,
  initialSize = DEFAULT_SIZE,
  minSize = DEFAULT_MIN_SIZE,
  draggable = true,
  resizable = true,
  closable = true,
  onClose,
  modal = false,
  onBackdropClick,
  className,
  headerClassName,
  bodyClassName,
  headerActions,
  style,
  storageKey,
}: GenericPanelProps) {
  const persistedState = useMemo(() => {
    if (!storageKey || typeof window === "undefined") {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(
        `${STORAGE_PREFIX}${storageKey}`
      );
      if (!raw) return null;
      return JSON.parse(raw) as {
        position?: Vec2;
        size?: Size;
      } | null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const [position, setPosition] = useState<Vec2>(
    persistedState?.position ?? initialPosition
  );
  const [size, setSize] = useState<Size>(
    persistedState?.size ?? initialSize
  );
  const panelRef = useRef<HTMLDivElement | null>(null);

  function clamp(value: number, min: number, max?: number) {
    if (typeof max === "number" && Number.isFinite(max)) {
      return Math.min(Math.max(value, min), max);
    }
    return Math.max(value, min);
  }

  function handleDragStart(event: React.MouseEvent) {
    if (!draggable) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPos = { ...position };
    const el = panelRef.current;
    const width = el?.offsetWidth ?? size.width;
    const height = el?.offsetHeight ?? size.height;
    const maxX = typeof window !== "undefined"
      ? Math.max(0, window.innerWidth - width)
      : undefined;
    const maxY = typeof window !== "undefined"
      ? Math.max(0, window.innerHeight - height)
      : undefined;

    function move(ev: MouseEvent) {
      setPosition({
        x: clamp(startPos.x + (ev.clientX - startX), 0, maxX),
        y: clamp(startPos.y + (ev.clientY - startY), 0, maxY),
      });
    }

    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  function handleResizeStart(event: React.MouseEvent) {
    if (!resizable) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = { ...size };
    function move(ev: MouseEvent) {
      setSize({
        width: Math.max(minSize.width, startSize.width + (ev.clientX - startX)),
        height: Math.max(
          minSize.height,
          startSize.height + (ev.clientY - startY)
        ),
      });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const rootClass = [styles.panel, className].filter(Boolean).join(" ");
  const headerClass = [styles.header, headerClassName]
    .filter(Boolean)
    .join(" ");
  const bodyClass = [styles.body, bodyClassName].filter(Boolean).join(" ");

  const backdropClick = onBackdropClick ?? onClose;

  const panelNode = (
    <div
      ref={panelRef}
      className={rootClass}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        ...style,
      }}
    >
      <div
        className={headerClass}
        onMouseDown={draggable ? handleDragStart : undefined}
      >
        <span className={styles.title}>{title}</span>
        <span className={styles.headerActions}>
          {headerActions}
          {closable && (
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Close panel"
              onClick={() => onClose?.()}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <div className={bodyClass}>{children}</div>
      {resizable && (
        <div
          role="presentation"
          className={styles.resizeHandle}
          onMouseDown={handleResizeStart}
        />
      )}
    </div>
  );

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }
    const payload = JSON.stringify({ position, size });
    window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, payload);
  }, [position, size, storageKey]);

  useEffect(() => {
    if (storageKey && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(
        `${STORAGE_PREFIX}${storageKey}`
      );
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.position) {
            setPosition(parsed.position);
          }
          if (parsed?.size) {
            setSize(parsed.size);
          }
          return;
        } catch {
          /* ignore */
        }
      }
    }
    setPosition(initialPosition);
    setSize(initialSize);
  }, [initialPosition, initialSize, storageKey]);

  return (
    <>
      {modal && (
        <div
          className={styles.backdrop}
          onClick={() => backdropClick?.()}
        />
      )}
      {panelNode}
    </>
  );
}
