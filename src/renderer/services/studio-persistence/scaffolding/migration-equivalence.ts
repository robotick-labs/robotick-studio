import type { StudioPersistenceModel } from "../types";

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeStudioPersistenceModelForMigrationComparison(
  model: StudioPersistenceModel
): StudioPersistenceModel {
  return {
    windows: sortById(model.windows),
    workbenches: sortById(model.workbenches).map((workbench) => ({
      ...workbench,
      layoutIds: [...workbench.layoutIds].sort(),
      windowIds: workbench.windowIds ? [...workbench.windowIds].sort() : undefined,
    })),
    layouts: sortById(model.layouts).map((layout) => ({
      ...layout,
      panelInstances: [...layout.panelInstances].sort((left, right) =>
        left.panelInstanceId.localeCompare(right.panelInstanceId)
      ),
      floatingPanels: layout.floatingPanels
        ? [...layout.floatingPanels].sort((left, right) =>
            left.panelInstanceId.localeCompare(right.panelInstanceId)
          )
        : undefined,
    })),
  };
}

export function areStudioPersistenceModelsMigrationEquivalent(
  left: StudioPersistenceModel,
  right: StudioPersistenceModel
): boolean {
  return (
    JSON.stringify(normalizeStudioPersistenceModelForMigrationComparison(left)) ===
    JSON.stringify(normalizeStudioPersistenceModelForMigrationComparison(right))
  );
}
