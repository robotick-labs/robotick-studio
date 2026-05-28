import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { launcherService } from "./data-sources/launcher";
import { loadInitialEditorRegistryState } from "./services/EditorRegistry";
import "./styles/global.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Failed to find #app container");
}

const root = ReactDOM.createRoot(container);

async function bootstrap() {
  const initialEditorRegistryState =
    await loadInitialEditorRegistryState(launcherService);

  root.render(
    <React.StrictMode>
      <App initialEditorRegistryState={initialEditorRegistryState} />
    </React.StrictMode>
  );
}

void bootstrap();
