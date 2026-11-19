/**
 * The person's accessibility choices, checked the same way in the main process
 * and the page. No Node or DOM imports: the page turns these into attributes
 * on <html>, and the stylesheet does the rest.
 */

/** More contrast: follow the computer, or always on, or always off. */
export const CONTRASTS = ["system", "more", "standard"] as const;
export type Contrast = (typeof CONTRASTS)[number];

/** Motion: follow the computer, or always less, or always the full motion. */
export const MOTIONS = ["system", "reduce", "full"] as const;
export type Motion = (typeof MOTIONS)[number];

/** How fast an answer is read aloud, as the speech engine's rate. */
export const READ_RATES = [0.8, 1, 1.25, 1.5] as const;
export type ReadRate = (typeof READ_RATES)[number];

export interface AccessibilityPrefs {
  contrast: Contrast;
  motion: Motion;
  /** Underline every link and every button that opens a page. */
  underlineLinks: boolean;
  /** A thicker focus ring, further from the control. */
  strongFocus: boolean;
  /** More space between lines, letters and words. */
  readingSpace: boolean;
  /** Bigger buttons and rows, easier to hit. */
  largeTargets: boolean;
  readRate: ReadRate;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPrefs = {
  contrast: "system",
  motion: "system",
  underlineLinks: false,
  strongFocus: false,
  readingSpace: false,
  largeTargets: false,
  readRate: 1,
};

const FLAGS = [
  "underlineLinks",
  "strongFocus",
  "readingSpace",
  "largeTargets",
] as const;

export function isContrast(value: unknown): value is Contrast {
  return CONTRASTS.some((c) => c === value);
}

export function isMotion(value: unknown): value is Motion {
  return MOTIONS.some((m) => m === value);
}

export function isReadRate(value: unknown): value is ReadRate {
  return READ_RATES.some((r) => r === value);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads the choices from a file that may be older than this version or edited
 * by hand: every value is checked, and anything unknown reads as its default.
 */
export function cleanAccessibility(raw: unknown): AccessibilityPrefs {
  const base = record(raw);
  return {
    contrast: isContrast(base.contrast)
      ? base.contrast
      : DEFAULT_ACCESSIBILITY.contrast,
    motion: isMotion(base.motion) ? base.motion : DEFAULT_ACCESSIBILITY.motion,
    underlineLinks: base.underlineLinks === true,
    strongFocus: base.strongFocus === true,
    readingSpace: base.readingSpace === true,
    largeTargets: base.largeTargets === true,
    readRate: isReadRate(base.readRate)
      ? base.readRate
      : DEFAULT_ACCESSIBILITY.readRate,
  };
}

/**
 * A change the page asks for. Strict, unlike a file: an unknown key or a value
 * that is not one of the choices is refused, never quietly dropped.
 */
export function accessibilityPatch(raw: unknown): Partial<AccessibilityPrefs> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("That is not allowed.");
  const patch: Partial<AccessibilityPrefs> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "contrast") {
      if (!isContrast(value)) throw new Error("That contrast is not known.");
      patch.contrast = value;
    } else if (key === "motion") {
      if (!isMotion(value)) throw new Error("That motion choice is not known.");
      patch.motion = value;
    } else if (key === "readRate") {
      if (!isReadRate(value))
        throw new Error("That reading speed is not known.");
      patch.readRate = value;
    } else if (FLAGS.some((flag) => flag === key)) {
      if (typeof value !== "boolean") throw new Error("That is not allowed.");
      patch[key as (typeof FLAGS)[number]] = value;
    } else {
      throw new Error("That is not allowed.");
    }
  }
  return patch;
}

/** What the computer itself asks for, read by the page from media queries. */
export interface SystemPrefs {
  reducedMotion: boolean;
  moreContrast: boolean;
}

/**
 * The attributes set on <html> (as `data-*`), with "follow the computer"
 * already worked out. A missing value means the attribute is removed.
 */
export interface HtmlAttributes {
  contrast: "more" | "standard";
  motion: "reduce" | "full";
  links: "underline" | undefined;
  focus: "strong" | undefined;
  reading: "spaced" | undefined;
  targets: "large" | undefined;
}

export function htmlAttributes(
  prefs: AccessibilityPrefs,
  system: SystemPrefs,
): HtmlAttributes {
  const more =
    prefs.contrast === "more" ||
    (prefs.contrast === "system" && system.moreContrast);
  const reduce =
    prefs.motion === "reduce" ||
    (prefs.motion === "system" && system.reducedMotion);
  return {
    contrast: more ? "more" : "standard",
    motion: reduce ? "reduce" : "full",
    links: prefs.underlineLinks ? "underline" : undefined,
    focus: prefs.strongFocus ? "strong" : undefined,
    reading: prefs.readingSpace ? "spaced" : undefined,
    targets: prefs.largeTargets ? "large" : undefined,
  };
}

/** One shortcut, as the shortcuts dialog lists it. */
export interface Shortcut {
  keys: string[];
  does: string;
}

/**
 * The real keys of the app, worked out for this computer and the person's
 * choice of what sends a message. Cmd on a Mac, Ctrl elsewhere.
 */
export function shortcuts(
  mac: boolean,
  sendWith: "enter" | "mod-enter",
): { group: string; items: Shortcut[] }[] {
  const mod = mac ? "Cmd" : "Ctrl";
  return [
    {
      group: "Anywhere",
      items: [
        { keys: [mod, "/"], does: "Show these shortcuts" },
        {
          keys: [mod, "K"],
          does: "Find an assistant, a chat, a screen or a setting",
        },
        { keys: ["Tab"], does: "Go to the next control" },
        { keys: ["Shift", "Tab"], does: "Go to the one before" },
        { keys: ["Enter"], does: "Press the button that has the focus" },
        {
          keys: ["Space"],
          does: "Press a button, or tick the box that has the focus",
        },
        {
          keys: ["Arrow keys"],
          does: "Move between the choices in a group",
        },
        {
          keys: ["Escape"],
          does: "Close a question or this list without doing anything",
        },
      ],
    },
    {
      group: "Message box",
      items:
        sendWith === "enter"
          ? [
              { keys: ["Enter"], does: "Send the message" },
              { keys: ["Shift", "Enter"], does: "Start a new line" },
            ]
          : [
              { keys: [mod, "Enter"], does: "Send the message" },
              { keys: ["Enter"], does: "Start a new line" },
            ],
    },
    {
      group: "View",
      items: [
        { keys: [mod, "+"], does: "Zoom in" },
        { keys: [mod, "-"], does: "Zoom out" },
        { keys: [mod, "0"], does: "Back to the normal size" },
      ],
    },
  ];
}
