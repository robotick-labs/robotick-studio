// header/launcher-dots.js

let timerId = null;

function start() {
  if (timerId) return; // already running

  const dots = document.querySelectorAll(".launcher-dots .dot");
  if (!dots.length) return;

  let index = 0;
  timerId = setInterval(() => {
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
    index = (index + 1) % dots.length;
  }, 500);
}

function stop() {
  if (!timerId) return;

  clearInterval(timerId);
  timerId = null;

  const dots = document.querySelectorAll(".launcher-dots .dot");
  dots.forEach((dot) => dot.classList.remove("active"));
}

export default { start, stop };
