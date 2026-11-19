import { catalogEntry } from "./connection-catalog";
import { cleanVersion } from "./update";

/**
 * The links the app opens in the person's browser, besides the StellarFirm
 * ones in cloud.ts. The page sends only a name from this list; the address is
 * built here, in code, and an unknown name is refused.
 */

// It must match "repository" in package.json, where a rename starts (a test
// checks). The update check refuses redirects, so a rename after a release
// would leave released copies unable to see updates.
export const REPO = "astrocodelp/openstellarfirm";
const REPO_URL = `https://github.com/${REPO}`;

export const LINK_NAMES = [
  "source",
  "community",
  "release",
  "download",
  "composio",
  "docker",
  "ollama",
  "lmstudio",
] as const;
export type LinkName = (typeof LINK_NAMES)[number];

/** Where the update check asks. Fixed: nothing from a page or an answer changes it. */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export function releaseUrl(version: string): string {
  const clean = cleanVersion(version);
  if (!clean) throw new Error("That is not allowed.");
  return `${REPO_URL}/releases/tag/v${clean}`;
}

/** Where this computer is: `process.platform` and `process.arch`. */
export interface DownloadTarget {
  platform: string;
  arch: string;
}

/**
 * The file a release has for this computer, by the names in
 * electron-builder.yml, or null when it has none (Linux on arm64, say).
 * Windows on arm64 runs the x64 build. Built from three plain numbers and a
 * fixed table, never from text in an answer.
 */
export function downloadFile(
  version: string,
  target: DownloadTarget,
): string | null {
  const clean = cleanVersion(version);
  if (!clean) return null;
  const name = `OpenStellarFirm-${clean}`;
  switch (target.platform) {
    case "darwin":
      if (target.arch === "arm64") return `${name}-mac-arm64.dmg`;
      if (target.arch === "x64") return `${name}-mac-x64.dmg`;
      return null;
    case "win32":
      return target.arch === "x64" || target.arch === "arm64"
        ? `${name}-win-x64.exe`
        : null;
    case "linux":
      return target.arch === "x64" ? `${name}-linux-x64.AppImage` : null;
    default:
      return null;
  }
}

/**
 * The address of this computer's download, or the release page when the
 * release has no file for it.
 */
export function downloadUrl(version: string, target: DownloadTarget): string {
  const file = downloadFile(version, target);
  if (!file) return releaseUrl(version);
  return `${REPO_URL}/releases/download/v${cleanVersion(version)}/${file}`;
}

/**
 * `newest` is the version the main process knows is available. The "release"
 * and "download" links exist only while there is one; "download" also needs
 * where this computer is.
 */
export function linkUrl(
  name: unknown,
  newest: string | null = null,
  target: DownloadTarget | null = null,
): string {
  // A catalog service's own page, looked up in the fixed list by its id.
  if (typeof name === "string" && name.startsWith("catalog:")) {
    const entry = catalogEntry(name.slice("catalog:".length));
    if (!entry) throw new Error("That is not allowed.");
    return entry.link;
  }
  switch (name) {
    case "source":
      return REPO_URL;
    case "community":
      return `${REPO_URL}/discussions`;
    case "composio":
      return "https://composio.dev";
    case "docker":
      return "https://docs.docker.com/get-started/get-docker/";
    // Where a first run with no model sends the person to get one.
    case "ollama":
      return "https://ollama.com/download";
    case "lmstudio":
      return "https://lmstudio.ai";
    case "release":
      if (!newest) throw new Error("There is no newer version to show.");
      return releaseUrl(newest);
    case "download":
      if (!newest) throw new Error("There is no newer version to download.");
      if (!target) throw new Error("That is not allowed.");
      return downloadUrl(newest, target);
    default:
      throw new Error("That is not allowed.");
  }
}
