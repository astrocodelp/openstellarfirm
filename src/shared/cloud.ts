/**
 * Links to StellarFirm, the cloud product by the same team. The app only ever
 * opens these in the person's browser, on their click. The addresses are fixed
 * here; nothing the page or a model says can change where a link goes.
 */

const CLOUD = "https://stellarfirm.ai";
/** A browser address longer than this is not reliable everywhere. */
const MAX_LINK = 12_000;
/** Windows cannot hand a longer address to the browser. */
export const MAX_LINK_WINDOWS = 2081;

/** What "Copy to StellarFirm cloud" carries: the same shape as an exported file. */
export interface CloudAssistant {
  format: "stellarfirm-open.assistant";
  version: 1;
  name: string;
  group: string;
  pet: string;
  color: string;
  brief: string;
  skills: string[];
}

export function cloudHomeUrl(): string {
  // The tags say only that the visit came from this app. Nothing personal.
  return `${CLOUD}/?utm_source=stellarfirm-open&utm_medium=app`;
}

function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The assistant travels after the "#", which a browser never sends to a
 * server. StellarFirm's page reads it in the browser and shows it to the
 * person, who decides there whether to hire it.
 */
export function cloudCopyUrl(
  assistant: CloudAssistant,
  maxLength = MAX_LINK,
): string {
  const url = `${CLOUD}/import-assistant#v=1&a=${base64Url(JSON.stringify(assistant))}`;
  if (url.length > maxLength) {
    throw new Error(
      "This assistant's brief is too long to copy by link. Shorten the brief, then copy again.",
    );
  }
  return url;
}
