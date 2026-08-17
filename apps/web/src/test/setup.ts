import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // App writes the theme onto <html>; reset so tests stay order-independent.
  document.documentElement.removeAttribute("data-theme");
  // The theme is persisted now, and jsdom keeps one localStorage for the whole
  // file — so a test that toggles it would otherwise decide the starting theme
  // for every test after it.
  window.localStorage.clear();
});
