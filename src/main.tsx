import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "@fontsource-variable/saira/wdth.css";
import "./styles/base.css";
import "./styles/hero.css";
import "./styles/event.css";
import "./styles/sections.css";
import App from "./App";
import { registerServiceWorker } from "./pwa";

// La cuenta y el panel de caja se cargan aparte: la portada no descarga ese código.
const AppRoot = lazy(() => import("./app/AppRoot"));

registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/*"
          element={
            <Suspense fallback={null}>
              <AppRoot />
            </Suspense>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
