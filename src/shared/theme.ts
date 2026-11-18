/** The theme choice. No Node or DOM imports. */

export const THEMES = ["system", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t === value);
}

/** An old file, or anything else unknown, reads as "follow the computer". */
export function cleanTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/** The window's colour before the page paints, so there is no flash. */
export function windowBackground(dark: boolean): string {
  return dark ? "#070709" : "#f3efe6";
}
