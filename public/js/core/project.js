// core/project.js
const KEY = "robotick-hub.projectPath";

function setProjectPath(path) {
  localStorage.setItem(KEY, path);
}

function getProjectPath() {
  return localStorage.getItem(KEY);
}

export default {
  setProjectPath,
  getProjectPath,
};
