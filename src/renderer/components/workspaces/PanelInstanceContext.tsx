import React from "react";

type PanelSettingsRecord = Record<string, unknown>;

export type PanelPersistenceDefinition<TSettings extends PanelSettingsRecord> = {
  schemaVersion: number;
  defaults: TSettings;
  sanitize?: (value: unknown) => TSettings;
  shouldPersist?: (settings: TSettings) => boolean;
};

export type StudioPanelContribution<
  TSettings extends PanelSettingsRecord = PanelSettingsRecord,
> = {
  component: React.ComponentType<Record<string, never>>;
  persistence?: PanelPersistenceDefinition<TSettings>;
};

export type PanelInstanceValue = {
  panelId?: string;
  workspaceId?: string;
  editorId?: string;
  settings: PanelSettingsRecord;
  setSettings: (settings: PanelSettingsRecord) => void;
  updateSettings: (settings: Partial<PanelSettingsRecord>) => void;
};

const EMPTY_SETTINGS: PanelSettingsRecord = {};
const NOOP = () => {};

export const PanelInstanceContext = React.createContext<PanelInstanceValue>({
  settings: EMPTY_SETTINGS,
  setSettings: NOOP,
  updateSettings: NOOP,
});

export type PanelInstanceProviderProps = PanelInstanceValue & {
  children: React.ReactNode;
};

export function PanelInstanceProvider({
  panelId,
  workspaceId,
  editorId,
  settings,
  setSettings,
  updateSettings,
  children,
}: PanelInstanceProviderProps) {
  return (
    <PanelInstanceContext.Provider
      value={{
        panelId,
        workspaceId,
        editorId,
        settings,
        setSettings,
        updateSettings,
      }}
    >
      {children}
    </PanelInstanceContext.Provider>
  );
}

export function usePanelInstance() {
  return React.useContext(PanelInstanceContext);
}

export function definePanelPersistence<TSettings extends PanelSettingsRecord>(
  definition: PanelPersistenceDefinition<TSettings>
): PanelPersistenceDefinition<TSettings> {
  return definition;
}

export function defineStudioPanel<
  TSettings extends PanelSettingsRecord = PanelSettingsRecord,
>(
  contribution: StudioPanelContribution<TSettings>
): StudioPanelContribution<TSettings> {
  return contribution;
}

function isRecord(value: unknown): value is PanelSettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePanelSettings<TSettings extends PanelSettingsRecord>(
  definition: PanelPersistenceDefinition<TSettings> | undefined,
  value: unknown
): TSettings {
  if (!definition) {
    return (isRecord(value) ? value : {}) as TSettings;
  }
  if (definition.sanitize) {
    return definition.sanitize(value);
  }
  return {
    ...definition.defaults,
    ...(isRecord(value) ? value : {}),
  };
}

export function usePanelSettings<TSettings extends PanelSettingsRecord>(
  definition?: PanelPersistenceDefinition<TSettings>
) {
  const panel = usePanelInstance();
  const settings = React.useMemo(
    () => resolvePanelSettings(definition, panel.settings),
    [definition, panel.settings]
  );
  const setSettings = React.useCallback(
    (nextSettings: TSettings) => {
      panel.setSettings(nextSettings);
    },
    [panel.setSettings]
  );
  const updateSettings = React.useCallback(
    (partial: Partial<TSettings>) => {
      panel.updateSettings(partial);
    },
    [panel.updateSettings]
  );

  return [settings, updateSettings, setSettings] as const;
}
