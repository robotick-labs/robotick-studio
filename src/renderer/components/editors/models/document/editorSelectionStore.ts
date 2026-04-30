import { useSyncExternalStore } from "react";

type Listener = () => void;

class EditorSelectionStore {
  private selectionByScope = new Map<string, string | null>();
  private listeners = new Set<Listener>();
  private static readonly DEFAULT_SCOPE = "default";

  getSelection = (scope: string = EditorSelectionStore.DEFAULT_SCOPE): string | null =>
    this.selectionByScope.get(scope) ?? null;

  setSelection = (
    id: string | null,
    scope: string = EditorSelectionStore.DEFAULT_SCOPE
  ) => {
    if (this.selectionByScope.get(scope) === id) return;
    this.selectionByScope.set(scope, id);
    this.listeners.forEach((l) => l());
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const editorSelectionStore = new EditorSelectionStore();

export function useSelection(scope: string = "default"): string | null {
  return useSyncExternalStore(
    editorSelectionStore.subscribe,
    () => editorSelectionStore.getSelection(scope),
    () => editorSelectionStore.getSelection(scope)
  );
}
