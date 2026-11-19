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

/**
 * `newest` is the version the main process knows is available. The "release"
 * link exists only while there is one.
 */
export function linkUrl(name: unknown, newest: string | null = null): string {
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
    default:
      throw new Error("That is not allowed.");
  }
}
