import { STUDIO_PERSISTENCE_SCHEMA_VERSION } from "./constants";

export type StudioResourceType =
  | "studio_window"
  | "studio_workbench"
  | "studio_layout";

export type StudioWindowRole = "main" | "child";
export type StudioWorkbenchSource = "builtin" | "project" | "user" | "session";
export type StudioResourceDirectory = "windows" | "workbenches" | "layouts";

export type StudioDockNode =
  | {
      nodeType: "panel";
      panelInstanceId: string;
    }
  | {
      nodeType: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [StudioDockNode, StudioDockNode];
    };

export type StudioPanelFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
};

export type StudioPanelInstance = {
  panelInstanceId: string;
  editorId: string;
  label?: string;
  settings?: Record<string, unknown>;
};

export type StudioFloatingPanelInstance = StudioPanelInstance & {
  frame: StudioPanelFrame;
};

export type StudioWindowResource = {
  resourceType: "studio_window";
  schemaVersion: typeof STUDIO_PERSISTENCE_SCHEMA_VERSION;
  id: string;
  slug: string;
  label: string;
  windowRole: StudioWindowRole;
  hostedWorkbenchIds: string[];
  defaultWorkbenchId?: string;
};

export type StudioWorkbenchResource = {
  resourceType: "studio_workbench";
  schemaVersion: typeof STUDIO_PERSISTENCE_SCHEMA_VERSION;
  id: string;
  slug: string;
  label: string;
  source: StudioWorkbenchSource;
  layoutIds: string[];
  defaultLayoutId?: string;
  windowIds?: string[];
};

export type StudioLayoutResource = {
  resourceType: "studio_layout";
  schemaVersion: typeof STUDIO_PERSISTENCE_SCHEMA_VERSION;
  id: string;
  slug: string;
  label: string;
  workbenchId: string;
  dockTree: StudioDockNode;
  panelInstances: StudioPanelInstance[];
  floatingPanels?: StudioFloatingPanelInstance[];
};

export type StudioResource =
  | StudioWindowResource
  | StudioWorkbenchResource
  | StudioLayoutResource;

export type StudioPersistenceModel = {
  windows: StudioWindowResource[];
  workbenches: StudioWorkbenchResource[];
  layouts: StudioLayoutResource[];
};

export type StudioPersistenceSource = "canonical" | "empty";

export type StudioPersistenceLoadResult = {
  source: StudioPersistenceSource;
  model: StudioPersistenceModel;
};
