import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAccessibility, mountAnnouncer } from "./a11y";
import { quietThemeSwaps } from "./ui";

quietThemeSwaps();
// Follow the computer's own motion and contrast until the saved choices load.
applyAccessibility(undefined);
mountAnnouncer();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
