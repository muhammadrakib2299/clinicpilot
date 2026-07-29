import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // App writes the theme onto <html>; reset so tests stay order-independent.
  document.documentElement.removeAttribute("data-theme");
});
