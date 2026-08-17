import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "clinicpilot:theme";

/**
 * Dark is the product's default, not the system's.
 *
 * So the question asked of the OS is "do you prefer *light*" — not "do you
 * prefer dark". An environment that reports neither (jsdom, an old browser, a
 * locked-down profile) falls through to dark, which is the control-plane
 * aesthetic `04-UI-UX.md` specifies as primary. Asking the other way round
 * would silently make light the default everywhere the media query is absent.
 */
function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Safari in private mode throws on localStorage rather than returning null.
    return null;
  }
}

/**
 * The theme, and the two things the old `useState<"dark">` in `App.tsx` did
 * not do: survive a reload, and start from what the user's machine asked for.
 *
 * A stored choice always wins — including over a later OS change, because
 * someone who picked light on this app meant it. The OS listener therefore
 * only applies while nothing is stored, which is the state a first-time
 * visitor is in.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (storedTheme()) return;

    const query = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!query?.addEventListener) return;

    const onChange = (event: MediaQueryListEvent) => {
      if (!storedTheme()) setTheme(event.matches ? "light" : "dark");
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // A theme that does not persist is worth strictly more than a crash.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
