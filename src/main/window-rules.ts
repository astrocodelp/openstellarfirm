import { dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What the main window's own page may load, kept apart from Electron so it is
 * tested offline. The page talks to the app through the bridge, never to the
 * network, so anything that is not one of the app's own files is cancelled.
 */

export interface WindowRequestRules {
  /** The address of the app's page (a file: address). */
  pageUrl: string;
  /** The dev server, only when the app runs from source; else undefined. */
  devUrl: string | undefined;
  packaged: boolean;
}

/** True when a request from the main window may go ahead. */
export function allowWindowRequest(
  url: string,
  rules: WindowRequestRules,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  switch (parsed.protocol) {
    case "file:": {
      // Only files beside the page (its scripts, styles, fonts and pictures).
      let path: string;
      let root: string;
      try {
        path = normalize(fileURLToPath(parsed));
        root = dirname(fileURLToPath(rules.pageUrl));
      } catch {
        return false;
      }
      return path.startsWith(root + sep);
    }
    // Made by the page itself in memory: no network is involved.
    case "data:":
    case "blob:":
      return true;
    case "devtools:":
      return !rules.packaged;
    case "http:":
    case "ws:": {
      // The dev server and its hot reload, on this computer, never installed.
      if (rules.packaged || !rules.devUrl) return false;
      const dev = new URL(rules.devUrl);
      return parsed.host === dev.host;
    }
    default:
      return false;
  }
}
