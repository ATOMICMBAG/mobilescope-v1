export type Theme = "light" | "dark";

const KEY = "mobilescope.theme";

/** Standard ist das helle Design; „dark“ wird nur auf ausdrückliche Wahl verwendet. */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* Speicher gesperrt: Wahl gilt nur für diese Sitzung */
  }
}
