import launcher from "./header/launcher-controls";
import combos from "./header/combo-populators";
import currentProject from "../core/current-project.js";

function enableClientSideNav() {
  const nav = document.querySelector("nav");
  if (!nav) return;

  const handleClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    if (!(event.target instanceof Element)) return;

    const anchor = event.target.closest("a[href]") as
      | HTMLAnchorElement
      | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//")) return;

    // Let BrowserRouter handle navigation via History API
    event.preventDefault();
    const nextUrl = new URL(href, window.location.origin);
    window.history.pushState({}, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  nav.addEventListener("click", handleClick);
}

export function initControls() {
  const playButton = document.querySelector<HTMLElement>(".icon-play")
    ?.parentElement;
  const restartButton = document.querySelector<HTMLElement>(".icon-restart")
    ?.parentElement;

  launcher.initLauncherControls({
    playButton,
    restartButton,
  });

  const projectCombo = document.getElementById(
    "current-project-combo"
  ) as HTMLSelectElement | null;
  if (projectCombo) {
    combos.populateProjectCombo(projectCombo);
    currentProject.onProjectChanged(() =>
      combos.populateProjectCombo(projectCombo)
    );
  }

  const profileCombo = document.getElementById(
    "launcher-profile-combo"
  ) as HTMLSelectElement | null;
  if (profileCombo) {
    combos.populateProfileCombo(profileCombo);
    currentProject.onProjectChanged(() =>
      combos.populateProfileCombo(profileCombo)
    );
  }

  enableClientSideNav();
}
