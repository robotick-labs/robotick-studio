type WindowEventKey = keyof WindowEventMap;
type DocumentEventKey = keyof DocumentEventMap;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

export function getWindow(): Window | undefined {
  return hasWindow() ? window : undefined;
}

export function getDocument(): Document | undefined {
  return hasDocument() ? document : undefined;
}

export function getDocumentBody(): HTMLElement | undefined {
  const doc = getDocument();
  return doc?.body;
}

export function getViewportSize(): { width: number; height: number } {
  const win = getWindow();
  if (!win) {
    return { width: 0, height: 0 };
  }
  return { width: win.innerWidth, height: win.innerHeight };
}

export function addWindowEventListener<K extends WindowEventKey>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): () => void {
  const win = getWindow();
  if (!win) {
    return () => {};
  }
  win.addEventListener(type, listener as EventListener, options);
  return () => {
    win.removeEventListener(type, listener as EventListener, options);
  };
}

export function addDocumentEventListener<K extends DocumentEventKey>(
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): () => void {
  const doc = getDocument();
  if (!doc) {
    return () => {};
  }
  doc.addEventListener(type, listener as EventListener, options);
  return () => {
    doc.removeEventListener(type, listener as EventListener, options);
  };
}

export function requestAnimationFrameSafe(
  cb: FrameRequestCallback
): number | undefined {
  const win = getWindow();
  if (!win || typeof win.requestAnimationFrame !== "function") {
    return undefined;
  }
  return win.requestAnimationFrame(cb);
}

export function cancelAnimationFrameSafe(handle: number | undefined): void {
  if (handle === undefined) return;
  const win = getWindow();
  if (!win || typeof win.cancelAnimationFrame !== "function") {
    return;
  }
  win.cancelAnimationFrame(handle);
}

export function setTimeoutSafe(
  handler: () => void,
  timeout: number
): number | undefined {
  const win = getWindow();
  if (!win || typeof win.setTimeout !== "function") {
    return undefined;
  }
  return win.setTimeout(handler, timeout);
}

export function clearTimeoutSafe(id: number | undefined): void {
  if (id === undefined) return;
  const win = getWindow();
  if (!win || typeof win.clearTimeout !== "function") {
    return;
  }
  win.clearTimeout(id);
}

export function setIntervalSafe(
  handler: () => void,
  interval: number
): number | undefined {
  const win = getWindow();
  if (!win || typeof win.setInterval !== "function") {
    return undefined;
  }
  return win.setInterval(handler, interval);
}

export function clearIntervalSafe(id: number | undefined): void {
  if (id === undefined) return;
  const win = getWindow();
  if (!win || typeof win.clearInterval !== "function") {
    return;
  }
  win.clearInterval(id);
}
