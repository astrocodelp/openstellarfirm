/**
 * An assistant's own computer: a Linux desktop in a Docker container on the
 * person's computer. The choices, the key rules and the shapes the page and
 * the main process share. No Node or DOM imports.
 */

/** The virtual screen, in pixels. Clicks are counted from its top left. */
export const SCREEN_WIDTH = 1280;
export const SCREEN_HEIGHT = 800;

export const MEMORY_CHOICES = [1, 2, 4, 8] as const;
export const CPU_CHOICES = [1, 2, 4] as const;
export const DEFAULT_MEMORY_GB = 2;
export const DEFAULT_CPUS = 2;

/** What the person set for one assistant's computer. Present means it is on. */
export interface ComputerSettings {
  /** Off by default: the computer has no network at all. */
  network: boolean;
  memoryGb: number;
  cpus: number;
}

export function defaultComputer(): ComputerSettings {
  return { network: false, memoryGb: DEFAULT_MEMORY_GB, cpus: DEFAULT_CPUS };
}

/**
 * Reads what the page sent. Anything that is not an object is "off"; a field
 * that is not one of the choices takes the safe default (no network, the
 * default limits).
 */
export function cleanComputer(raw: unknown): ComputerSettings | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const memory = MEMORY_CHOICES.find((m) => m === value.memoryGb);
  const cpus = CPU_CHOICES.find((c) => c === value.cpus);
  return {
    network: value.network === true,
    memoryGb: memory ?? DEFAULT_MEMORY_GB,
    cpus: cpus ?? DEFAULT_CPUS,
  };
}

/** Whether Docker can be used: none found, found but not running, or ready. */
export type DockerState = "missing" | "stopped" | "ready";

export interface ComputerStatus {
  docker: DockerState;
  /** The engine's version, when it answered. */
  version?: string;
  /** True once the computer's image is built on this computer. */
  image: boolean;
  /** True while the image is being built. */
  building: boolean;
}

/** Who may use the computer right now. */
export type ComputerHold = "none" | "paused" | "taken";

export interface ComputerView {
  /** "none" before it was ever started, "off" when stopped, "on" when running. */
  container: "none" | "off" | "on";
  hold: ComputerHold;
  /** The folder on this computer it shares, as plain text. */
  exchange: string;
}

/** One picture of the computer's screen for the live view. */
export interface ComputerShot {
  /** A data address of the picture. */
  src: string;
  at: string;
}

/** A line from setting up the computer. */
export interface ComputerProgress {
  line: string;
  state: "running" | "done" | "failed";
}

export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";

/** What the person does on the live view while they have taken over. */
export type ComputerInput =
  | { kind: "click"; x: number; y: number; button: MouseButton }
  | { kind: "key"; key: string }
  | { kind: "type"; text: string }
  | {
      kind: "scroll";
      x: number;
      y: number;
      direction: ScrollDirection;
      amount: number;
    };

const MODIFIERS: Record<string, string> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  super: "super",
  meta: "super",
  win: "super",
  cmd: "ctrl",
  command: "ctrl",
};

/** Named keys, by the names models and people use, to the X11 names. */
const NAMED: Record<string, string> = {
  enter: "Return",
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  page_up: "Page_Up",
  pagedown: "Page_Down",
  page_down: "Page_Down",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  space: "space",
  menu: "Menu",
};
for (let n = 1; n <= 12; n += 1) NAMED[`f${n}`] = `F${n}`;

/** Single characters that may follow a modifier, by their X11 names. */
const PUNCTUATION: Record<string, string> = {
  "-": "minus",
  "=": "equal",
  "+": "plus",
  ",": "comma",
  ".": "period",
  "/": "slash",
  ";": "semicolon",
  "'": "apostrophe",
  "[": "bracketleft",
  "]": "bracketright",
  "\\": "backslash",
  "`": "grave",
};

export const MAX_KEY_LENGTH = 40;

/**
 * Turns one key or one combination ("Enter", "ctrl+c", "ctrl+shift+t") into
 * the name xdotool takes, or null when it is not on the list. Only named keys,
 * letters, digits and a few signs are on it, with at most four modifiers: a
 * key name can never become an option or another command.
 */
export function normalizeKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_KEY_LENGTH) return null;
  // "ctrl++" means ctrl and the plus key.
  const parts = text.endsWith("++")
    ? [...text.slice(0, -2).split("+"), "+"]
    : text.split("+");
  if (parts.some((part) => part === "")) return null;
  const last = parts.pop() ?? "";
  if (parts.length > 4) return null;
  const mods: string[] = [];
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (!mod || mods.includes(mod)) return null;
    mods.push(mod);
  }
  let key: string | undefined = NAMED[last.toLowerCase()];
  if (!key && /^[a-zA-Z0-9]$/.test(last)) key = last.toLowerCase();
  if (!key && last.length === 1) key = PUNCTUATION[last];
  if (!key) return null;
  return [...mods, key].join("+");
}

/** A key press on the live view, as the browser reports it. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * What a key press on the live view sends: a character to type, a key to
 * press, or nothing (a modifier on its own, or a key not on the list). Cmd
 * on a Mac stands for Ctrl, as the computer inside is Linux.
 */
export function inputFromKey(press: KeyPress): ComputerInput | null {
  const { key } = press;
  if (["Control", "Alt", "Shift", "Meta", "OS", "CapsLock"].includes(key))
    return null;
  const command = press.ctrlKey || press.metaKey || press.altKey;
  if (key.length === 1 && !command) return { kind: "type", text: key };
  const mods = [
    press.ctrlKey || press.metaKey ? "ctrl" : "",
    press.altKey ? "alt" : "",
    // Shift is part of a typed character; it is kept only with a named key
    // or a command.
    press.shiftKey && (command || key.length > 1) ? "shift" : "",
  ].filter(Boolean);
  const name = key === " " ? "space" : key;
  const combined = normalizeKey([...mods, name].join("+"));
  return combined ? { kind: "key", key: combined } : null;
}
