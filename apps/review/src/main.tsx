import React from "react";
import ReactDOM from "react-dom/client";
import "@reviewradar/theme/index.css";
import { applyTheme, readThemePreference } from "@reviewradar/theme";
import App from "./App";

// Apply theme before render to avoid flash
applyTheme(readThemePreference());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
