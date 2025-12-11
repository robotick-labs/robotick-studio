import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addWindowEventListener,
  getViewportSize,
} from "../../utils/domEnvironment";
import { readStorageValue, setStorageValue } from "../../services/storage";
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
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  headerActions?: React.ReactNode;
  style?: React.CSSProperties;
  storageKey?: string;
};

const DEFAULT_POSITION: Vec2 = { x: 160, y: 160 };
const DEFAULT_SIZE: Size = { width: 640, height: 400 };
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
  className,
  headerClassName,
  bodyClassName,
  headerActions,
  style,
  storageKey,
}: GenericPanelProps) {
  const persistedState = useMemo(() => {
    if (!storageKey) {
      return null;
    }
    try {
      const raw = readStorageValue(`${STORAGE_PREFIX}${storageKey}`);
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
  const [size, setSize] = useState<Size>(persistedState?.size ?? initialSize);
  const panelRef = useRef<HTMLDivElement | null>(null);

  function clamp(value: number, min: number, max?: number) {
    if (typeof max === "number" && Number.isFinite(max)) {
      return Math.min(Math.max(value, min), max);
    }
    return Math.max(value, min);
  }

  function clampPositionToViewport(
    pos: Vec2,
    size: Size,
    viewport?: Size
  ): Vec2 {
    const view = viewport ?? getViewportSize();
    const width = view.width || size.width * 2;
    const height = view.height || size.height * 2;
    const maxX = Math.max(0, width - size.width);
    const maxY = Math.max(0, height - size.height);
    return {
      x: clamp(pos.x, 0, maxX),
      y: clamp(pos.y, 0, maxY),
    };
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
    const viewportSize = getViewportSize();
    const maxX = Math.max(0, (viewportSize.width || width) - width);
    const maxY = Math.max(0, (viewportSize.height || height) - height);

    function move(ev: MouseEvent) {
      setPosition({
        x: clamp(startPos.x + (ev.clientX - startX), 0, maxX),
        y: clamp(startPos.y + (ev.clientY - startY), 0, maxY),
      });
    }

    const up = () => {
      removeMove();
      removeUp();
    };

    const removeMove = addWindowEventListener("mousemove", move);
    const removeUp = addWindowEventListener("mouseup", up);
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
    const up = () => {
      removeMove();
      removeUp();
    };
    const removeMove = addWindowEventListener("mousemove", move);
    const removeUp = addWindowEventListener("mouseup", up);
  }

  const rootClass = [styles.panel, className].filter(Boolean).join(" ");
  const headerClass = [styles.header, headerClassName]
    .filter(Boolean)
    .join(" ");
  const bodyClass = [styles.body, bodyClassName].filter(Boolean).join(" ");

  const viewport = getViewportSize();
  const clampedPosition = clampPositionToViewport(position, size, viewport);

  const panelNode = (
    <div
      ref={panelRef}
      className={rootClass}
      style={{
        left: clampedPosition.x,
        top: clampedPosition.y,
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
    if (!storageKey) {
      return;
    }
    try {
      const payload = JSON.stringify({ position, size });
      setStorageValue(`${STORAGE_PREFIX}${storageKey}`, payload);
    } catch {
      /* ignore */
    }
  }, [position, size, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      setPosition(initialPosition);
      setSize(initialSize);
      return;
    }
    const raw = readStorageValue(`${STORAGE_PREFIX}${storageKey}`);
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
    setPosition(initialPosition);
    setSize(initialSize);
  }, [
    storageKey,
    initialPosition.x,
    initialPosition.y,
    initialSize.width,
    initialSize.height,
  ]);

  return panelNode;
}
