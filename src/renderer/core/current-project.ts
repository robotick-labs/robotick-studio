const KEY_PROJECT_PATH = "robotick-hub.projectPath";
const KEY_LAUNCHER_PROFILE = "robotick-hub.launcherProfile";

type ProjectChangedListener = (path: string) => void;

const listeners = new Set<ProjectChangedListener>();

function setProjectPath(path: string) {
  localStorage.setItem(KEY_PROJECT_PATH, path);
  notifyProjectChanged(path);
}

function getProjectPath(): string {
  return localStorage.getItem(KEY_PROJECT_PATH) ?? "";
}

function setLauncherProfile(value: string) {
  localStorage.setItem(KEY_LAUNCHER_PROFILE, value);
}

function getLauncherProfile(): string {
  return localStorage.getItem(KEY_LAUNCHER_PROFILE) ?? "";
}

function notifyProjectChanged(path: string) {
  for (const callback of listeners) {
    try {
      callback(path);
    } catch (err) {
      console.error("Error in onProjectChanged listener:", err);
    }
  }
}

function onProjectChanged(callback: ProjectChangedListener) {
  listeners.add(callback);
  return () => listeners.delete(callback); // return unsubscribe function
}

export default {
  setProjectPath,
  getProjectPath,
  setLauncherProfile,
  getLauncherProfile,
  onProjectChanged,
};
