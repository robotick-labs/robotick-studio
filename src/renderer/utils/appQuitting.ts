let appQuitting = false;

function markAppQuitting() {
  appQuitting = true;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", markAppQuitting);
  window.addEventListener("robotick:app-quitting", markAppQuitting);
}

export function isAppQuitting(): boolean {
  return appQuitting;
}

