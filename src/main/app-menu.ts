import type { MenuItemConstructorOptions } from "electron";

/**
 * The app's own menu and the switches an installed app refuses to start with.
 * Pure, so a test can read them; `index.ts` builds the menu from this.
 *
 * Electron's default menu has Toggle Developer Tools, and the developer tools
 * can press Approve for the person or read what the page holds. An installed
 * app's menu leaves them out (and every window has `devTools: false` too);
 * the edit, zoom and window items stay. Run from source, the menu also has
 * Reload and the developer tools, for work on the app.
 */
export function menuTemplate(
  platform: NodeJS.Platform,
  packaged: boolean,
): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = [
    ...(packaged
      ? []
      : ([
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
        ] satisfies MenuItemConstructorOptions[])),
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  return [
    ...(platform === "darwin"
      ? ([{ role: "appMenu" }] satisfies MenuItemConstructorOptions[])
      : ([{ role: "fileMenu" }] satisfies MenuItemConstructorOptions[])),
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
  ];
}

/**
 * Command-line switches that would let another program drive or inspect an
 * installed app: Chromium's remote debugging (a port or a pipe) and Node's
 * inspector in each of its spellings. The fuses already switch Node's off;
 * this is the second wall, and the app quits when it sees one.
 */
export const REFUSED_SWITCHES = [
  "remote-debugging-port",
  "remote-debugging-pipe",
  "remote-debugging-address",
  "remote-allow-origins",
  "inspect",
  "inspect-brk",
  "inspect-port",
  "inspect-publish-uid",
  "inspect-wait",
  "debug",
  "debug-brk",
  "debug-port",
  "js-flags",
] as const;

/** True when an installed app was started with a switch it refuses. */
export function refusedLaunch(
  packaged: boolean,
  hasSwitch: (name: string) => boolean,
  argv: readonly string[],
): boolean {
  if (!packaged) return false;
  if (REFUSED_SWITCHES.some((name) => hasSwitch(name))) return true;
  // A switch Chromium does not parse is still on the command line.
  return argv.slice(1).some((arg) => {
    const name = /^--?([a-z-]+)/i.exec(arg)?.[1]?.toLowerCase();
    return (
      name !== undefined &&
      (REFUSED_SWITCHES as readonly string[]).includes(name)
    );
  });
}
