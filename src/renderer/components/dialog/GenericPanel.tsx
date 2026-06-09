import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  addWindowEventListener,
  getViewportSize,
} from "../../utils/domEnvironment";
import styles from "./GenericPanel.module.css";

type Vec2 = { x: number; y: number };
type Size = { width: number; height: number };
type PanelFrame = {
  position: Vec2;
  size: Size;
};

export type GenericPanelProps = {
  title?: React.ReactNode;
  children: React.ReactNode;
  initialPosition?: Vec2;
  initialSize?: Size;
  position?: Vec2;
  size?: Size;
  minSize?: Size;
  draggable?: boolean;
  resizable?: boolean;
  closable?: boolean;
  onClose?: () => void;
  onFrameChange?: (frame: PanelFrame) => void;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  headerActions?: React.ReactNode;
  style?: React.CSSProperties;
};

const DEFAULT_POSITION: Vec2 = { x: 160, y: 160 };
const DEFAULT_SIZE: Size = { width: 640, height: 400 };
const DEFAULT_MIN_SIZE: Size = { width: 260, height: 180 };

/**
 * Renders a movable, resizable panel with an optional title, header actions, and persistent position/size.
 *
 * @param title - Optional header title shown in the panel's header.
 * @param children - Panel body content.
 * @param initialPosition - Position used when there is no persisted state.
 * @param initialSize - Size used when there is no persisted state.
 * @param position - Controlled position for the panel when managed by a parent container.
 * @param size - Controlled size for the panel when managed by a parent container.
 * @param minSize - Minimum allowed size when resizing.
 * @param draggable - If `true`, the panel can be dragged by its header.
 * @param resizable - If `true`, the panel can be resized via the resize handle.
 * @param closable - If `true`, a close button is shown in the header.
 * @param onClose - Called when the close button is clicked.
 * @param onFrameChange - Called whenever the panel's position or size changes.
 * @param className - Additional class for the root element.
 * @param headerClassName - Additional class for the header element.
 * @param bodyClassName - Additional class for the body element.
 * @param headerActions - Additional elements rendered to the right side of the header.
 * @param style - Inline styles applied to the root element.
 * @returns The rendered panel element.
 */
export function GenericPanel({
  title,
  children,
  initialPosition = DEFAULT_POSITION,
  initialSize = DEFAULT_SIZE,
  position: controlledPosition,
  size: controlledSize,
  minSize = DEFAULT_MIN_SIZE,
  draggable = true,
  resizable = true,
  closable = true,
  onClose,
  onFrameChange,
  className,
  headerClassName,
  bodyClassName,
  headerActions,
  style,
}: GenericPanelProps) {
  const initialFrame = useMemo(
    () => ({
      position: controlledPosition ?? initialPosition,
      size: controlledSize ?? initialSize,
    }),
    [controlledPosition, controlledSize, initialPosition, initialSize]
  );
  const [position, setPosition] = useState<Vec2>(initialFrame.position);
  const [size, setSize] = useState<Size>(initialFrame.size);
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

  const applyFrame = React.useCallback(
    (nextPosition: Vec2, nextSize: Size) => {
      setPosition(nextPosition);
      setSize(nextSize);
      onFrameChange?.({
        position: nextPosition,
        size: nextSize,
      });
    },
    [onFrameChange]
  );

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
      applyFrame(
        {
        x: clamp(startPos.x + (ev.clientX - startX), 0, maxX),
        y: clamp(startPos.y + (ev.clientY - startY), 0, maxY),
        },
        size
      );
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
      applyFrame(position, {
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
    setPosition(controlledPosition ?? initialPosition);
  }, [controlledPosition, initialPosition]);

  useEffect(() => {
    setSize(controlledSize ?? initialSize);
  }, [
    controlledSize,
    initialSize,
  ]);

  return panelNode;
}
