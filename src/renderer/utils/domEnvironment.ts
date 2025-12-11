type WindowEventKey = keyof WindowEventMap;
type DocumentEventKey = keyof DocumentEventMap;

/**
 * Detects whether a global `window` object is available.
 *
 * @returns `true` if a global `window` value is defined, `false` otherwise.
 */
function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Determines whether the global `document` object is available in the current environment.
 *
 * @returns `true` if the global `document` object is defined, `false` otherwise.
 */
function hasDocument(): boolean {
  return typeof document !== "undefined";
}

/**
 * Retrieve the global Window object when running in a browser environment.
 *
 * @returns The global `window` object if available, `undefined` otherwise.
 */
export function getWindow(): Window | undefined {
  return hasWindow() ? window : undefined;
}

/**
 * Retrieve the global Document object when running in a DOM environment.
 *
 * @returns The global `document` if available, otherwise `undefined`.
 */
export function getDocument(): Document | undefined {
  return hasDocument() ? document : undefined;
}

/**
 * Retrieve the document's body element when a global `document` is available.
 *
 * @returns The document's `body` element if available, `undefined` otherwise.
 */
export function getDocumentBody(): HTMLElement | undefined {
  return getDocument()?.body;
}

/**
 * Get the current viewport width and height in pixels, or zero dimensions when no window is available.
 *
 * @returns An object with `width` and `height` measured in pixels; both are `0` if the global `window` is not present.
 */
export function getViewportSize(): { width: number; height: number } {
  const win = getWindow();
  if (!win) {
    return { width: 0, height: 0 };
  }
  return { width: win.innerWidth, height: win.innerHeight };
}

/**
 * Registers an event listener on the global window and returns a cleanup function.
 *
 * If no global window is available, returns a no-op cleanup function.
 *
 * @param type - The window event type to listen for
 * @param listener - Callback invoked with the event when it occurs
 * @param options - Optional options or boolean passed to addEventListener/removeEventListener
 * @returns A function that removes the registered listener when called; a no-op if the listener was not added
 */
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

/**
 * Attaches an event listener to the global `document` and returns a cleanup function.
 *
 * @param type - The document event type to listen for (key of `DocumentEventMap`)
 * @param listener - Callback invoked when the event fires
 * @param options - Optional `addEventListener` options or boolean capture flag
 * @returns A function that removes the registered listener; returns a no-op function if `document` is not available
 */
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

/**
 * Requests an animation frame using the global window when available.
 *
 * @param cb - Callback invoked with a DOMHighResTimeStamp when the browser is ready to repaint
 * @returns The numeric handle returned by `requestAnimationFrame`, or `undefined` if `window` or the API is unavailable
 */
export function requestAnimationFrameSafe(
  cb: FrameRequestCallback
): number | undefined {
  const win = getWindow();
  if (!win || typeof win.requestAnimationFrame !== "function") {
    return undefined;
  }
  return win.requestAnimationFrame(cb);
}

/**
 * Cancels a previously scheduled animation frame request when a global window with the API is available.
 *
 * @param handle - The animation frame handle to cancel; if `undefined`, the call is a no-op
 */
export function cancelAnimationFrameSafe(handle: number | undefined): void {
  if (handle === undefined) return;
  const win = getWindow();
  if (!win || typeof win.cancelAnimationFrame !== "function") {
    return;
  }
  win.cancelAnimationFrame(handle);
}

/**
 * Schedules a callback with the environment's `setTimeout` when available.
 *
 * @param handler - Callback to invoke after the delay
 * @param timeout - Delay in milliseconds
 * @returns The timer id returned by `setTimeout`, or `undefined` if no window or `setTimeout` is not available
 */
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

/**
 * Clears a scheduled timeout using the global window's clearTimeout when available.
 *
 * If `id` is `undefined`, or if there is no global window with a `clearTimeout` function, this function does nothing.
 *
 * @param id - The identifier of the timeout to clear
 */
export function clearTimeoutSafe(id: number | undefined): void {
  if (id === undefined) return;
  const win = getWindow();
  if (!win || typeof win.clearTimeout !== "function") {
    return;
  }
  win.clearTimeout(id);
}

/**
 * Schedules repeated execution of `handler` using the global `window` when available.
 *
 * @param handler - Function to be invoked on each interval tick
 * @param interval - Time between invocations in milliseconds
 * @returns The numeric interval ID from `setInterval` if scheduled, or `undefined` if the environment does not provide `window.setInterval`
 */
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

/**
 * Clears the active interval identified by `id` on the global window.
 *
 * If `id` is `undefined`, or if a global `window` is not available or does not support `clearInterval`, the function performs no action.
 *
 * @param id - The interval identifier to clear; may be `undefined` to indicate no-op
 */
export function clearIntervalSafe(id: number | undefined): void {
  if (id === undefined) return;
  const win = getWindow();
  if (!win || typeof win.clearInterval !== "function") {
    return;
  }
  win.clearInterval(id);
}