import type { ModelData, Workload } from "../services/projectModelsLoader";

export interface WorkloadSpec {
  name: string;
  type?: string;
}
export interface LaneRef {
  modelId: string;
  laneIndex: number;
}

export class ModelStore {
  // key: modelId (path)
  private models = new Map<string, ModelData>();
  version = 0;

  load(models: { modelPath: string; data: ModelData }[]) {
    this.models.clear();
    for (const m of models)
      this.models.set(m.modelPath, structuredClone(m.data));
    this.version++;
  }

  getModelIds(): string[] {
    return [...this.models.keys()];
  }
  get(modelId: string): ModelData | undefined {
    return this.models.get(modelId);
  }

  /** Children (= lane order) for a lane root (SyncedGroupWorkload child). */
  laneChildren(modelId: string, laneIndex: number): string[] {
    const m = this.models.get(modelId)!;
    const root = m.workloads.find((w) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];
    const parentName = lanes[laneIndex];
    const parent = m.workloads.find((w) => w.name === parentName)!;
    return parent.children ? [...parent.children] : [parent.name];
  }

  /** Replace order in lane (in-place on the right parent). */
  private setLaneChildren(modelId: string, laneIndex: number, names: string[]) {
    const m = this.models.get(modelId)!;
    const root = m.workloads.find((w) => w.name === m.root)!;
    const lanes =
      root.type === "SyncedGroupWorkload" ? root.children ?? [] : [root.name];
    const parentName = lanes[laneIndex];
    const parent = m.workloads.find((w) => w.name === parentName)!;
    if (!parent.children) {
      // singleton lane; upgrading to children list with itself + others
      parent.children = [parent.name];
    }
    parent.children = names;
    this.version++;
  }

  /** Move one item within lane with insertion semantics. */
  moveWithinLane(
    modelId: string,
    laneIndex: number,
    fromSlot: number,
    toSlot: number
  ) {
    const names = this.laneChildren(modelId, laneIndex);
    if (fromSlot < 0 || fromSlot >= names.length) return;
    // clamp to allowable insertion range (0..names.length)
    const clampedTo = Math.max(0, Math.min(toSlot, names.length));
    const [moved] = names.splice(fromSlot, 1);
    names.splice(clampedTo, 0, moved);
    this.setLaneChildren(modelId, laneIndex, names);
  }

  /** Insert a new workload at slot; create Workload entry if missing. */
  insertAt(
    modelId: string,
    laneIndex: number,
    slot: number,
    spec: WorkloadSpec
  ) {
    const m = this.models.get(modelId)!;
    // create workload if not present
    if (!m.workloads.find((w) => w.name === spec.name)) {
      m.workloads.push({ name: spec.name, type: spec.type });
    }
    const names = this.laneChildren(modelId, laneIndex);
    const clamped = Math.max(0, Math.min(slot, names.length));
    names.splice(clamped, 0, spec.name);
    this.setLaneChildren(modelId, laneIndex, names);
  }

  rename(modelId: string, oldName: string, next: string) {
    const m = this.models.get(modelId)!;
    const w = m.workloads.find((x) => x.name === oldName);
    if (!w) return;
    // rename workload
    w.name = next;
    // fix references in children arrays
    for (const ww of m.workloads) {
      if (ww.children)
        ww.children = ww.children.map((n) => (n === oldName ? next : n));
    }
    // fix connections
    for (const c of m.connections ?? []) {
      c.from = c.from.replace(new RegExp(`^${oldName}\\.`), `${next}.`);
      c.to = c.to.replace(new RegExp(`^${oldName}\\.`), `${next}.`);
    }
    this.version++;
  }
}
