export {
  STUDIO_PERSISTENCE_SCHEMA_VERSION,
  STUDIO_RESOURCE_DIRECTORIES,
} from "./constants";
export type {
  StudioDockNode,
  StudioFloatingPanelInstance,
  StudioLayoutResource,
  StudioPanelFrame,
  StudioPanelInstance,
  StudioResourceType,
  StudioWindowResource,
  StudioWindowRole,
  StudioWorkbenchResource,
  StudioWorkbenchSource,
} from "./types";
export {
  getStudioLayoutResourcePath,
  getStudioLayoutsDirectoryPath,
  getStudioProjectDirectory,
  getStudioResourcePaths,
  getStudioRootPath,
  getStudioWindowResourcePath,
  getStudioWindowsDirectoryPath,
  getStudioWorkbenchResourcePath,
  getStudioWorkbenchesDirectoryPath,
} from "./paths";
