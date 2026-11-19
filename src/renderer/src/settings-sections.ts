/**
 * The sections of the Settings screen, in the order they stand there. The
 * screen's headings and Find anything both read this one list, so a new
 * section can always be found.
 */
export const SETTINGS_SECTIONS = [
  {
    id: "appearance",
    title: "Appearance",
    keywords: "theme dark light text size bigger",
  },
  {
    id: "accessibility",
    title: "Accessibility",
    keywords:
      "contrast motion animation focus ring underline links read aloud speech voice larger targets screen reader keyboard",
  },
  {
    id: "chat",
    title: "Chat",
    keywords: "send enter key new line message box",
  },
  { id: "cloud", title: "StellarFirm cloud", keywords: "card sidebar" },
  {
    id: "reading",
    title: "Reading other languages",
    keywords: "ocr scan scanned picture pdf language download text",
  },
  {
    id: "main",
    title: "Main assistant",
    keywords: "check on its own schedule notify update look for",
  },
  {
    id: "approvals",
    title: "Approvals",
    keywords: "always allow sites reads forget ask",
  },
  { id: "data", title: "Your data", keywords: "data folder delete chats" },
  { id: "updates", title: "Updates", keywords: "version check new release" },
  { id: "about", title: "About", keywords: "version licence license" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** A section's heading, as the screen shows it. */
export function sectionTitle(id: SettingsSectionId): string {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`No settings section ${id}`);
  return found.title;
}
