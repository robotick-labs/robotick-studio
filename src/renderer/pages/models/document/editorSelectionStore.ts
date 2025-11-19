import { useSyncExternalStore } from "react";

type Listener = () => void;

class EditorSelectionStore {
  private selection: string | null = null;
  private listeners = new Set<Listener>();

  getSelection = (): string | null => this.selection;

  setSelection = (id: string | null) => {
    if (this.selection === id) return;
    this.selection = id;
    this.listeners.forEach((l) => l());
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

export const editorSelectionStore = new EditorSelectionStore();

export function useSelection(): string | null {
  return useSyncExternalStore(
    editorSelectionStore.subscribe,
    editorSelectionStore.getSelection,
    editorSelectionStore.getSelection
  );
}
