// header/launcher-dots.js

let timerId = null;

function setModeEllipses() {
  if (timerId) return; // already running

  const dots = document.querySelectorAll(".launcher-dots .dot");
  if (!dots.length) return;

  let index = 0;
  timerId = setInterval(() => {
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
      dot.classList.remove("heartbeat-on");
      dot.classList.remove("heartbeat-off");
    });
    index = (index + 1) % dots.length;
  }, 500);
}

function setModeHeartbeat() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }

  const dots = document.querySelectorAll(".launcher-dots .dot");
  if (!dots.length) return;

  const middleIndex = Math.floor(dots.length / 2);

  dots.forEach((dot, i) => {
    dot.classList.remove("active");
    if (i === middleIndex) {
      dot.classList.add("heartbeat-on");
    } else {
      dot.classList.add("heartbeat-off");
    }
  });

  // No interval needed — heartbeat is continuous animation
  timerId = -1; // mark as "set" to prevent re-entering
}

function setModeStopped() {
  if (!timerId) return;

  clearInterval(timerId);
  timerId = null;

  const dots = document.querySelectorAll(".launcher-dots .dot");
  dots.forEach((dot) => dot.classList.remove("active"));
  dots.forEach((dot) => dot.classList.remove("heartbeat-on"));
  dots.forEach((dot) => dot.classList.remove("heartbeat-off"));
}

export default { setModeEllipses, setModeHeartbeat, setModeStopped };
