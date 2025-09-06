import launcher from "./header/launcher-controls.js";
import combos from "./header/combo-populators.js";
import currentProject from "/js/core/current-project.js";

export function initControls(host) {
  console.log(`[Robotick Hub] Header Controls init from: '${host}'`);

  launcher.initLauncherControls({
    playButton: document.querySelector(".icon-play")?.parentElement,
    restartButton: document.querySelector(".icon-restart")?.parentElement,
  });

  const projectCombo = document.getElementById("current-project-combo");
  if (projectCombo) {
    combos.populateProjectCombo(projectCombo);
    currentProject.onProjectChanged(() =>
      combos.populateProjectCombo(projectCombo)
    );
  }

  const profileCombo = document.getElementById("launcher-profile-combo");
  if (profileCombo) {
    combos.populateProfileCombo(profileCombo);
    currentProject.onProjectChanged(() =>
      combos.populateProfileCombo(profileCombo)
    );
  }
}
