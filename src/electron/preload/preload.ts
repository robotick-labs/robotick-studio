import { contextBridge } from "electron";

const robotickGlobals = {
  environment: {
    isStandaloneApp: true,
    appTitle: "Robotick Studio",
  },
};

contextBridge.exposeInMainWorld("robotick", robotickGlobals);
