// core/current-project.js
const KEY = "robotick-hub.projectPath";
const listeners = new Set();

function setProjectPath(path) {
  localStorage.setItem(KEY, path);
  notifyProjectChanged(path);
}

function getProjectPath() {
  return localStorage.getItem(KEY);
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
  onProjectChanged,
};
