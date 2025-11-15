// core/current-project.js
const KEY_PROJECT_PATH = "robotick-hub.projectPath";
const KEY_LAUNCHER_PROFILE = "robotick-hub.launcherProfile";
const listeners = new Set();

function setProjectPath(path) {
  localStorage.setItem(KEY_PROJECT_PATH, path);
  notifyProjectChanged(path);
}

function getProjectPath() {
  return localStorage.getItem(KEY_PROJECT_PATH);
}

function setLauncherProfile(value) {
  localStorage.setItem(KEY_LAUNCHER_PROFILE, value);
}

function getLauncherProfile() {
  return localStorage.getItem(KEY_LAUNCHER_PROFILE);
}

function notifyProjectChanged(path) {
  for (const callback of listeners) {
    try {
      callback(path);
    } catch (err) {
      console.error("Error in onProjectChanged listener:", err);
    }
  }
}

function onProjectChanged(callback) {
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
