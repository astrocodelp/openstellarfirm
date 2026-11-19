import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type AccessibilityPrefs,
  cleanAccessibility,
  htmlAttributes,
  type SystemPrefs,
} from "../../shared/accessibility";

/**
 * The page's side of accessibility: the person's choices as attributes on
 * <html>, the one live region that tells a screen reader what happened, and
 * read aloud. Nothing here runs when the module is imported, so the pure parts
 * can be tested without a page.
 */

// ---------------------------------------------------------------------------
// The choices, as attributes on <html>

const ATTRIBUTES = [
  "contrast",
  "motion",
  "links",
  "focus",
  "reading",
  "targets",
] as const;

let current: AccessibilityPrefs = cleanAccessibility(undefined);
let watching = false;

function system(): SystemPrefs {
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    moreContrast: window.matchMedia("(prefers-contrast: more)").matches,
  };
}

function paint(): void {
  const root = document.documentElement;
  const attrs = htmlAttributes(current, system());
  for (const name of ATTRIBUTES) {
    const value = attrs[name];
    if (value === undefined) delete root.dataset[name];
    else root.dataset[name] = value;
  }
}

/**
 * Sets the attributes from the saved choices, and keeps "follow this computer"
 * in step when the computer's own setting changes while the app is open.
 */
export function applyAccessibility(prefs: unknown): void {
  current = cleanAccessibility(prefs);
  paint();
  if (watching) return;
  watching = true;
  for (const query of [
    "(prefers-reduced-motion: reduce)",
    "(prefers-contrast: more)",
  ])
    window.matchMedia(query).addEventListener("change", paint);
}

/** True when the page shows less motion, by the person's choice or the computer's. */
export function motionReduced(): boolean {
  const set = document.documentElement.dataset.motion;
  if (set) return set === "reduce";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------------------------------------------------------------------------
// The announcer: one polite live region for the whole app

let region: HTMLElement | null = null;
let clearing: ReturnType<typeof setTimeout> | undefined;

/** Makes the live region. It must be in the page before anything is said. */
export function mountAnnouncer(): void {
  if (region?.isConnected) return;
  region = document.createElement("div");
  region.className = "visually-hidden";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.dataset.announcer = "";
  document.body.append(region);
}

/**
 * Tells a screen reader something that happened: an answer finished, a step
 * that waits for an Approve, an error. Polite, so it never cuts the person off.
 */
export function announce(text: string): void {
  mountAnnouncer();
  const node = region;
  if (!node || !text.trim()) return;
  // Emptied first, so the same sentence twice is still read twice.
  node.textContent = "";
  clearTimeout(clearing);
  setTimeout(() => {
    node.textContent = text;
    // Gone after a while, so it is not found again when reading the page.
    clearing = setTimeout(() => {
      node.textContent = "";
    }, 7000);
  }, 60);
}

// ---------------------------------------------------------------------------
// Read aloud, with the computer's own voices only

/** The parts of a voice this code reads. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/**
 * Only voices that run on this computer. A voice that is not local sends the
 * text to a server to be spoken, and nothing here may leave the computer.
 */
export function localVoices<V extends VoiceLike>(voices: readonly V[]): V[] {
  return voices.filter((voice) => voice.localService === true);
}

/**
 * The voice to read with: a local one in the page's language, the computer's
 * default first, else any local voice. None when no voice is local.
 */
export function pickVoice<V extends VoiceLike>(
  voices: readonly V[],
  lang: string,
): V | undefined {
  const local = localVoices(voices);
  const base = lang.toLowerCase().split("-")[0] ?? "";
  const same = local.filter(
    (v) => v.lang.toLowerCase().split(/[-_]/)[0] === base,
  );
  return (
    same.find((v) => v.default) ??
    same[0] ??
    local.find((v) => v.default) ??
    local[0]
  );
}

type Availability = "checking" | "yes" | "no";

interface SpeechState {
  /** The id of what is being read now, if anything. */
  speaking: string | null;
  available: Availability;
}

let speech: SpeechState = { speaking: null, available: "checking" };
const listeners = new Set<() => void>();
let voicesWatched = false;

function setSpeech(next: Partial<SpeechState>): void {
  speech = { ...speech, ...next };
  for (const listener of listeners) listener();
}

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

function lookForVoices(): void {
  const engine = synth();
  if (!engine) {
    setSpeech({ available: "no" });
    return;
  }
  const check = () => {
    const voices = engine.getVoices();
    if (voices.length > 0)
      setSpeech({
        available: pickVoice(voices, document.documentElement.lang || "en")
          ? "yes"
          : "no",
      });
  };
  check();
  if (voicesWatched) return;
  voicesWatched = true;
  engine.addEventListener("voiceschanged", check);
  // Some systems never fire the event when there are no voices at all.
  setTimeout(() => {
    if (speech.available === "checking") setSpeech({ available: "no" });
  }, 2000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (speech.available === "checking") lookForVoices();
  return () => listeners.delete(listener);
}

/** What is being read now, and whether this computer has a local voice. */
export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribe, () => speech);
}

/** The id of what is being read right now, if anything. */
export function speakingNow(): string | null {
  return speech.speaking;
}

/** Stops reading, whatever is being read. */
export function stopSpeaking(): void {
  synth()?.cancel();
  setSpeech({ speaking: null });
}

/**
 * Reads a text aloud with a local voice. Refuses when there is none, rather
 * than letting the engine fall back to a voice that runs on a server.
 */
export function speak(id: string, text: string, rate: number): boolean {
  const engine = synth();
  if (!engine) return false;
  const voice = pickVoice(
    engine.getVoices(),
    document.documentElement.lang || "en",
  );
  if (!voice) {
    setSpeech({ available: "no" });
    return false;
  }
  engine.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = rate;
  const done = () => {
    if (speech.speaking === id) setSpeech({ speaking: null });
  };
  utterance.addEventListener("end", done);
  utterance.addEventListener("error", done);
  setSpeech({ speaking: id, available: "yes" });
  engine.speak(utterance);
  return true;
}

// ---------------------------------------------------------------------------
// A modal dialog: focus in, focus trapped, Escape closes, focus given back

/**
 * Opens a native <dialog> as a modal while `open` is true. The browser keeps
 * the focus inside it and makes the page behind it inert; Escape closes it.
 * When it closes, the focus goes back to what had it before.
 */
export function useModalDialog(
  ref: { current: HTMLDialogElement | null },
  open: boolean,
): void {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setOpener(
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      );
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, ref]);
  useEffect(() => {
    if (open || !opener) return;
    if (opener.isConnected) focusBack(opener);
    setOpener(null);
  }, [open, opener]);
}

/**
 * Gives the focus back to where it was. A heading or a message that Find
 * anything jumped to held the focus only for that visit, and gave up its
 * stop when it lost it; it gets one again, for this visit too, so the focus
 * does not fall to the top of the page. Returns false when it still did not take.
 */
export function focusBack(el: HTMLElement): boolean {
  el.focus({ preventScroll: true });
  if (document.activeElement === el) return true;
  if (el.hasAttribute("tabindex")) return false;
  el.setAttribute("tabindex", "-1");
  el.addEventListener("blur", () => el.removeAttribute("tabindex"), {
    once: true,
  });
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

// ---------------------------------------------------------------------------
// A count told once the typing rests

/**
 * The text once it has stopped changing for `ms`. Empty at first, so a count
 * is not read out just because a screen opened; after that, each settled
 * change is told once, never on every key.
 */
export function useSettledText(text: string, ms = 500): string {
  const [settled, setSettled] = useState("");
  const [first] = useState(text);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (!moved && text === first) return;
    setMoved(true);
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms, first, moved]);
  return settled;
}

// ---------------------------------------------------------------------------
// Focus that would be lost

/** After the next paint, when the new state is on the page. */
export function afterPaint(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/** True when nothing has the focus: the control that had it has gone. */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/**
 * A button that removes itself (Delete, Undo, Keep summary) takes the focus
 * with it, and the keyboard is sent back to the top of the page. After the
 * change is on the page, the focus goes to `target`, but only when it really
 * was lost: a person who has moved on keeps their place.
 */
export function refocusIfLost(
  target: () => HTMLElement | null | undefined,
): void {
  afterPaint(() => {
    if (focusLost()) target()?.focus({ preventScroll: true });
  });
}
