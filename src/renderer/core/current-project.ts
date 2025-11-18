const KEY_PROJECT_PATH = "robotick-hub.projectPath";
const KEY_LAUNCHER_PROFILE = "robotick-hub.launcherProfile";

type ProjectChangedListener = (path: string) => void;
type LauncherProfileChangedListener = (profile: string) => void;

const projectListeners = new Set<ProjectChangedListener>();
const profileListeners = new Set<LauncherProfileChangedListener>();

function setProjectPath(path: string) {
  localStorage.setItem(KEY_PROJECT_PATH, path);
  notifyProjectChanged(path);
}

function getProjectPath(): string {
  return localStorage.getItem(KEY_PROJECT_PATH) ?? "";
}

function setLauncherProfile(value: string) {
  localStorage.setItem(KEY_LAUNCHER_PROFILE, value);
  notifyLauncherProfileChanged(value);
}

function getLauncherProfile(): string {
  return localStorage.getItem(KEY_LAUNCHER_PROFILE) ?? "";
}

function notifyProjectChanged(path: string) {
  for (const callback of projectListeners) {
    try {
      callback(path);
    } catch (err) {
      console.error("Error in onProjectChanged listener:", err);
    }
  }
}

function notifyLauncherProfileChanged(profile: string) {
  for (const callback of profileListeners) {
    try {
      callback(profile);
    } catch (err) {
      console.error("Error in onLauncherProfileChanged listener:", err);
    }
  }
}

function onProjectChanged(callback: ProjectChangedListener) {
  projectListeners.add(callback);
  return () => projectListeners.delete(callback);
}

function onLauncherProfileChanged(callback: LauncherProfileChangedListener) {
  profileListeners.add(callback);
  return () => profileListeners.delete(callback);
}

export default {
  setProjectPath,
  getProjectPath,
  setLauncherProfile,
  getLauncherProfile,
  onProjectChanged,
  onLauncherProfileChanged,
};
