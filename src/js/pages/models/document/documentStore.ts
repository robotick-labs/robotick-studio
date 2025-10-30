import type { ModelData, Workload } from "./modelData";

export class ModelStore {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  entries(): IterableIterator<[string, ModelData]> {
    return this.models.entries();
  }

  private models = new Map<string, ModelData>();
  version = 0;

  load(models: { modelPath: string; data: ModelData }[]) {
    this.models.clear();
    for (const m of models)
      this.models.set(m.modelPath, structuredClone(m.data));
    this.version++;
    this.notify();
  }

  getModelIds(): string[] {
    return [...this.models.keys()].sort();
  }

  get(modelId: string): ModelData | undefined {
    return this.models.get(modelId);
  }

  laneChildren(modelId: string, laneIndex: number): string[] {
    const m = this.models.get(modelId)!;
    const root = m.workloads.find((w) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];
    const parentName = lanes[laneIndex];
    const parent = m.workloads.find((w) => w.name === parentName)!;
    return parent.children ? [...parent.children] : [parent.name];
  }

  private setLaneChildren(modelId: string, laneIndex: number, names: string[]) {
    const m = this.models.get(modelId)!;
    const root = m.workloads.find((w) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];
    const parentName = lanes[laneIndex];
    const parent = m.workloads.find((w) => w.name === parentName)!;
    if (!parent.children) {
      parent.children = [parent.name];
    }
    parent.children = names;
    this.version++;
    this.notify();
  }

  moveWithinLane(
    modelId: string,
    laneIndex: number,
    fromSlot: number,
    toSlot: number
  ) {
    const names = this.laneChildren(modelId, laneIndex);
    if (fromSlot < 0 || fromSlot >= names.length) return;
    const clampedTo = Math.max(0, Math.min(toSlot, names.length));
    const [moved] = names.splice(fromSlot, 1);
    names.splice(clampedTo, 0, moved);
    this.setLaneChildren(modelId, laneIndex, names);
  }

  insertAt(
    modelId: string,
    laneIndex: number,
    slot: number,
    workload: Workload
  ) {
    const m = this.models.get(modelId)!;
    if (!m.workloads.find((w) => w.name === workload.name)) {
      m.workloads.push(workload);
    }
    const names = this.laneChildren(modelId, laneIndex);
    const clamped = Math.max(0, Math.min(slot, names.length));
    names.splice(clamped, 0, workload.name);
    this.setLaneChildren(modelId, laneIndex, names);
  }

  rename(modelId: string, oldName: string, newName: string) {
    const m = this.models.get(modelId)!;
    const w = m.workloads.find((x) => x.name === oldName);
    if (!w) return;
    w.name = newName;
    for (const ww of m.workloads) {
      if (ww.children)
        ww.children = ww.children.map((n) => (n === oldName ? newName : n));
    }
    for (const c of m.connections ?? []) {
      c.from = c.from.replace(new RegExp(`^${oldName}\.`), `${newName}.`);
      c.to = c.to.replace(new RegExp(`^${oldName}\.`), `${newName}.`);
    }
    this.version++;
    this.notify();
  }
}
