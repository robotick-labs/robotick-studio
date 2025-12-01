import { contextBridge, ipcRenderer } from "electron";

const expose = () => {
  const windowControls = {
    minimize: () =>
      ipcRenderer.invoke("robotick-window-command", { command: "minimize" }),
    maximize: () =>
      ipcRenderer.invoke("robotick-window-command", { command: "maximize" }),
    restore: () =>
      ipcRenderer.invoke("robotick-window-command", { command: "restore" }),
    close: () =>
      ipcRenderer.invoke("robotick-window-command", { command: "close" }),
    toggleMaximize: () =>
      ipcRenderer.invoke("robotick-window-command", {
        command: "toggleMaximize",
      }),
    showSystemMenu: (x: number, y: number) =>
      ipcRenderer.invoke("robotick-window-command", {
        command: "systemMenu",
        x,
        y,
      }),
    onStateChange: (callback: (state: { isMaximized: boolean }) => void) => {
      const listener = (_event: unknown, state: { isMaximized: boolean }) => {
        callback(state);
      };
      ipcRenderer.on("robotick-window-state", listener);
      ipcRenderer
        .invoke("robotick-window-command", { command: "state" })
        .then((state) => callback(state));
      return () => {
        ipcRenderer.removeListener("robotick-window-state", listener);
      };
    },
  };

  const robotickGlobals = {
    environment: {
      isStandaloneApp: true,
      appTitle: "Robotick Studio",
    },
    windowControls,
  };

  contextBridge.exposeInMainWorld("robotick", robotickGlobals);
};

expose();
