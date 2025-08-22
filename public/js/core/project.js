// core/project.js
const KEY = "robotick-hub.projectPath";

export function setProjectPath(path) {
  localStorage.setItem(KEY, path);
}

export function getProjectPath() {
  return localStorage.getItem(KEY);
}
