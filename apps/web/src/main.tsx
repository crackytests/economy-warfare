import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./store";
import { App } from "./App";
import "./theme/tokens.css";
import "./app.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
