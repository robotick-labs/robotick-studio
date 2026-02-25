export type RcModuleDescriptor = {
  type: string;
  config?: Record<string, unknown>;
};

export type RcSettingsResponse = {
  modules?: unknown;
  viewer?: Record<string, unknown>;
};

export function normalizeRcModules(
  settings: RcSettingsResponse | null
): RcModuleDescriptor[] {
  if (!settings) return [];
  const modules: RcModuleDescriptor[] = [];

  const rawModules = Array.isArray(settings.modules) ? settings.modules : [];
  for (const raw of rawModules) {
    if (!raw || typeof raw !== "object") continue;
    const type = String((raw as { type?: unknown }).type ?? "").trim();
    if (!type) continue;
    const config = (raw as { config?: Record<string, unknown> }).config;
    modules.push({ type, config });
  }

  return modules;
}
