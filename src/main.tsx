import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CameraPreview from "./CameraPreview";
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTauri() && getCurrentWindow().label === 'camera-preview' ? <CameraPreview /> : <App />}
  </React.StrictMode>,
);
