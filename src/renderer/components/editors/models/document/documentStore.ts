import type { ModelData } from "./modelData";
import { loadAllModels } from "./modelData";

export interface WorkloadSpec {
  name: string;
  type?: string;
}

type WorkloadSection = "config" | "inputs" | "outputs";

export class DocumentStore {
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
  private modelSourcePaths = new Map<string, string>();
  version = 0;

  async load(projectPath: string | null | undefined) {
    this.models.clear();
    this.modelSourcePaths.clear();

    if (!projectPath) {
      this.version++;
      this.notify();
      return;
    }

    const loadedModels = await loadAllModels(projectPath);

    for (const m of loadedModels) {
      const model = structuredClone(m.data);
      this.models.set(model.id, model);
      this.modelSourcePaths.set(model.id, m.modelPath);
    }
    this.version++;
    this.notify();
  }

  getModelIds(): string[] {
    return [...this.models.keys()].sort();
  }
  get(modelId: string): ModelData | undefined {
    return this.models.get(modelId);
  }
  getModelSourcePath(modelId: string): string | undefined {
    return this.modelSourcePaths.get(modelId);
  }

  private requireWorkload(model: ModelData, workloadId: string) {
    return model.workloads.find((w) => w.id === workloadId);
  }

  laneChildren(modelId: string, laneIndex: number): string[] {
    const m = this.models.get(modelId)!;
    const root = this.requireWorkload(m, m.root.workload_id)!;
    const lanes =
      root.type === "SyncedGroupWorkload"
        ? (root.children ?? []).map((child) => child.workload_id)
        : [root.id];
    const parentId = lanes[laneIndex];
    const parent = this.requireWorkload(m, parentId)!;
    return parent.children
      ? parent.children.map((child) => child.workload_id)
      : [parent.id];
  }

  private setLaneChildren(modelId: string, laneIndex: number, ids: string[]) {
    const m = this.models.get(modelId)!;
    const root = this.requireWorkload(m, m.root.workload_id)!;
    const lanes =
      root.type === "SyncedGroupWorkload"
        ? (root.children ?? []).map((child) => child.workload_id)
        : [root.id];
    const parentId = lanes[laneIndex];
    const parent = this.requireWorkload(m, parentId)!;
    if (!parent.children) {
      parent.children = [{ workload_id: parent.id }];
    }
    parent.children = ids.map((id) => ({ workload_id: id }));
    this.version++;
    this.notify();
  }

  moveWithinLane(
    modelId: string,
    laneIndex: number,
    fromSlot: number,
    toSlot: number
  ) {
    const ids = this.laneChildren(modelId, laneIndex);
    if (fromSlot < 0 || fromSlot >= ids.length) return;
    const clampedTo = Math.max(0, Math.min(toSlot, ids.length));
    const [moved] = ids.splice(fromSlot, 1);
    ids.splice(clampedTo, 0, moved);
    this.setLaneChildren(modelId, laneIndex, ids);
  }

  insertAt(
    modelId: string,
    laneIndex: number,
    slot: number,
    spec: WorkloadSpec
  ) {
    const m = this.models.get(modelId)!;
    if (!m.workloads.find((w) => w.name === spec.name)) {
      m.workloads.push({
        id: `${spec.type ?? "workload"}_${crypto.randomUUID().slice(0, 8)}`,
        name: spec.name,
        type: spec.type,
        tick_rate_hz: 0,
        config: {},
        inputs: {},
      });
    }
    const inserted = m.workloads.find((w) => w.name === spec.name);
    if (!inserted) return;
    const ids = this.laneChildren(modelId, laneIndex);
    const clamped = Math.max(0, Math.min(slot, ids.length));
    ids.splice(clamped, 0, inserted.id);
    this.setLaneChildren(modelId, laneIndex, ids);
  }

  rename(modelId: string, oldName: string, next: string) {
    const m = this.models.get(modelId)!;
    const w = m.workloads.find((x) => x.name === oldName);
    if (!w) return;
    w.name = next;
    this.version++;
    this.notify();
  }

  clearWorkloadFieldOverride(
    modelId: string,
    workloadName: string,
    section: WorkloadSection,
    fieldPath: string
  ) {
    const model = this.models.get(modelId);
    if (!model) return;
    const workload = model.workloads.find((w) => w.name === workloadName);
    if (!workload) return;

    const sectionValues = workload[section];
    if (!sectionValues || typeof sectionValues !== "object") return;

    const path = fieldPath.split(".").filter(Boolean);
    if (path.length === 0) return;

    unsetAtPath(sectionValues as Record<string, unknown>, path);
    this.version++;
    this.notify();
  }
}

function unsetAtPath(target: Record<string, unknown>, path: string[]) {
  const [head, ...tail] = path;
  if (!head) return;
  if (tail.length === 0) {
    delete target[head];
    return;
  }
  const next = target[head];
  if (!next || typeof next !== "object" || Array.isArray(next)) {
    return;
  }
  unsetAtPath(next as Record<string, unknown>, tail);
  if (Object.keys(next as Record<string, unknown>).length === 0) {
    delete target[head];
  }
}
