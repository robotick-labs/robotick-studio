// header/launcher-dots.tsx

type DotElement = Element & {
  classList: DOMTokenList;
};

let timerId: ReturnType<typeof setInterval> | null = null;
let heartbeatActive = false;

function getDots(): DotElement[] {
  return Array.from(
    document.querySelectorAll<DotElement>(".launcher-dots .dot")
  );
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
  }
  timerId = null;
}

function resetDots(dots: DotElement[]) {
  dots.forEach((dot) => {
    dot.classList.remove("active");
    dot.classList.remove("heartbeat-on");
    dot.classList.remove("heartbeat-off");
  });
}

function setModeEllipses() {
  if (timerId && !heartbeatActive) return; // already running
  heartbeatActive = false;
  stopTimer();

  const dots = getDots();
  if (!dots.length) return;
  resetDots(dots);

  let index = 0;
  timerId = setInterval(() => {
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
    index = (index + 1) % dots.length;
  }, 500);
}

function setModeHeartbeat() {
  heartbeatActive = true;
  stopTimer();

  const dots = getDots();
  if (!dots.length) return;

  const middleIndex = Math.floor(dots.length / 2);

  dots.forEach((dot, i) => {
    dot.classList.remove("active");
    dot.classList.toggle("heartbeat-on", i === middleIndex);
    dot.classList.toggle("heartbeat-off", i !== middleIndex);
  });
}

function setModeStopped() {
  heartbeatActive = false;
  stopTimer();

  const dots = getDots();
  resetDots(dots);
}

export default { setModeEllipses, setModeHeartbeat, setModeStopped };
