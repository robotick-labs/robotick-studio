// header.js

export function initControls(host) {
  console.log(`[Robotick Hub] Header Controls init from: '${host}'`);

  let isPlaying = false;

  const playButton = document.querySelector(".icon-play")?.parentElement;
  const restartButton = document.querySelector(".icon-restart")?.parentElement;
  const stopButton = document.querySelector(".icon-stop")?.parentElement;

  if (!playButton) {
    console.warn("Launcher play button not found");
    return;
  }

  if (!restartButton) {
    console.warn("Launcher restart button not found");
    return;
  }

  function updateUI() {
    const playIcon = playButton.querySelector("span");
    playIcon.textContent = isPlaying ? "⏹" : "▶";
    playIcon.className = isPlaying ? "icon-stop" : "icon-play";

    if (isPlaying) {
      restartButton.classList.remove("disabled");
      restartButton.style.pointerEvents = "auto";
      restartButton.style.opacity = "1.0";
    } else {
      restartButton.classList.add("disabled");
      restartButton.style.pointerEvents = "none";
      restartButton.style.opacity = "0.4";
    }
  }

  playButton.addEventListener("click", () => {
    isPlaying = !isPlaying;
    updateUI();
    console.log(`[Launcher] ${isPlaying ? "Started" : "Stopped"}`);
  });

  restartButton.addEventListener("click", () => {
    if (!isPlaying) return;
    console.log("[Launcher] Restart triggered");
  });

  updateUI();
}
