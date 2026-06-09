import { STUDIO_PERSISTENCE_SCHEMA_VERSION } from "./constants";

export type StudioWindowRole = "main" | "child";
export type StudioWorkbenchGroup =
  | "project-select"
  | "dev"
  | "test"
  | "help";

export type StudioPanelFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
};

export type StudioDockPanel = {
  nodeType: "panel";
  panelId: string;
  editorId: string;
  label?: string;
  settings?: Record<string, unknown>;
};

export type StudioDockSplit = {
  nodeType: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [StudioDockNode, StudioDockNode];
};

export type StudioDockNode = StudioDockPanel | StudioDockSplit;

export type StudioFloatingPanelInstance = {
  id: string;
  editorId: string;
  label?: string;
  settings?: Record<string, unknown>;
  frame: StudioPanelFrame;
};

export type StudioLayoutResource = {
  id: string;
  label: string;
  dock: StudioDockNode;
  floatingPanels?: StudioFloatingPanelInstance[];
};

export type StudioWorkbenchResource = {
  id: string;
  path?: string;
  label: string;
  group?: StudioWorkbenchGroup;
  defaultEditorId?: string;
  defaultLayoutId?: string;
  layouts: StudioLayoutResource[];
};

export type StudioWindowResource = {
  id: string;
  label: string;
  windowRole: StudioWindowRole;
  defaultWorkbenchId?: string;
  workbenches: StudioWorkbenchResource[];
};

export type StudioDocument = {
  resourceType: "studio_document";
  schemaVersion: typeof STUDIO_PERSISTENCE_SCHEMA_VERSION;
  id: string;
  windows: StudioWindowResource[];
};

export type StudioPersistenceModel = StudioDocument;

export type StudioPersistenceSource = "canonical" | "seed";

export type StudioPersistenceLoadResult = {
  source: StudioPersistenceSource;
  model: StudioPersistenceModel;
};
