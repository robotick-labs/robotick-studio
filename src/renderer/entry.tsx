import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./global.css";
import "./legacy-styles.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Failed to find #app container");
}

const root = ReactDOM.createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
