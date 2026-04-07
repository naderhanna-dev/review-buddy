export type ThemePreference = "system" | "dark" | "light";

const THEME_STORAGE_KEY = "review-radar.theme";

export function readThemePreference(): ThemePreference {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "dark" || val === "light" || val === "system") return val;
  } catch {}
  return "system";
}

export function resolveTheme(pref: ThemePreference): "dark" | "light" {
  if (pref === "dark" || pref === "light") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref);
  if (resolved === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function writeThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {}
  applyTheme(pref);
}
