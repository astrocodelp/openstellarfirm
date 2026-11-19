import type { ChatStep, Decision } from "../shared/types";
import {
  type ImagePart,
  ModelError,
  type ToolSpec,
  type WireMessage,
} from "./wires/common";

/**
 * Looking at the screen, and nothing else. The tool takes one picture of the
 * whole screen; it never moves the mouse, types, or reaches another app.
 *
 * The rules, all kept here:
 * - Every look asks the person first. There is no "always": whatever a page
 *   sends back for this step, it is read as a single approval.
 * - The picture is taken only after that approval, at that moment.
 * - The picture lives in memory for one answer. It is never written to a file,
 *   never saved in the chat, never logged, and only the newest one is sent on.
 */

export const SCREEN_TOOL_NAME = "look_at_screen";

export const SCREEN_TOOL: ToolSpec = {
  name: SCREEN_TOOL_NAME,
  description:
    "Look at the person's screen: one picture of everything visible now. The person is asked every time. You can only look; you cannot click or type.",
  parameters: {
    type: "object",
    properties: {
      display: {
        type: "integer",
        description:
          "Which screen to look at, counting from 1. Leave it out for the main screen.",
      },
    },
  },
};

/** The longer side of the picture, tried largest first. */
const SIDES = [1568, 1280, 1024, 768, 512];
const QUALITIES = [80, 60, 40];
export const MAX_PICTURE_BYTES = 1_500_000;

/** The words that stand where an older picture was. */
export const REMOVED_PICTURE = "[an earlier look at the screen was removed]";
export const PICTURE_TEXT = "The screen was captured. The picture follows.";
export const NO_PICTURES_TEXT =
  "The screen was captured, but this model cannot read pictures, so you cannot see it. Tell the person you could not see their screen.";

/** A grabbed screen. The real one wraps an Electron image. */
export interface Frame {
  /** True when the system gave back nothing at all. */
  empty: boolean;
  /** A JPEG no longer than `maxSide` on its longer side. */
  encode(maxSide: number, quality: number): Uint8Array;
}

export interface ScreenDeps {
  /** Where the picture goes: "on this computer", or the service's name. */
  where: string;
  platform: string;
  /** The system's answer on screen recording, such as "granted". */
  permission(): string;
  /**
   * Makes the system ask for the permission, without keeping any picture.
   * Only called while the answer is "not-determined", so the app can appear in
   * the list the person has to allow it in.
   */
  askPermission?(): Promise<void>;
  /** How many screens there are. */
  screens(): number;
  /** Takes the picture of one screen (0 is the main one). */
  capture(index: number): Promise<Frame | undefined>;
  now?: () => Date;
}

/** What the screen tool needs from the agent. */
export interface ScreenHost {
  ask(ask: ScreenAsk): Promise<Decision>;
  onActivity(label: string): void;
  signal: AbortSignal;
  screen?: ScreenDeps;
}

/** The same shape as the agent's other asks. A screen ask never has a site. */
export interface ScreenAsk {
  title: string;
  detail: string;
  why: string;
}

export interface ScreenResult {
  text: string;
  image?: ImagePart;
}

export class ScreenError extends Error {}

export const PERMISSION_LINE =
  "OpenStellar is not allowed to record the screen yet. Tell the person to open System Settings, then Privacy & Security, then Screen Recording, allow OpenStellar there, and try again. You cannot look until they do.";

export function screenAsk(where: string): ScreenAsk {
  return {
    title: "Your assistant wants to look at your screen now",
    detail: `Everything visible on your screen right now goes to your model, ${where}.`,
    why: "A screen can show private things. Close anything private before you approve. It asks every time, and it takes the picture only after you approve.",
  };
}

function displayOf(raw: string): number | undefined {
  let args: unknown;
  try {
    args = JSON.parse(raw || "{}");
  } catch {
    throw new ScreenError(
      "The tool call was not written correctly. Try again.",
    );
  }
  const value = (args as { display?: unknown } | null)?.display;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ScreenError(
      "The screen number must be a whole number from 1. Leave it out for the main screen.",
    );
  }
  return value;
}

/** Encodes the frame under the size cap, or says plainly that it cannot. */
export function pictureOf(frame: Frame): ImagePart {
  if (frame.empty) {
    throw new ScreenError(
      "The screen came back empty. On Linux this often means the desktop does not allow other programs to capture it, as under Wayland.",
    );
  }
  for (const side of SIDES) {
    for (const quality of QUALITIES) {
      const bytes = frame.encode(side, quality);
      if (bytes.length === 0) continue;
      if (bytes.length <= MAX_PICTURE_BYTES) {
        return {
          mediaType: "image/jpeg",
          data: Buffer.from(bytes).toString("base64"),
        };
      }
    }
  }
  throw new ScreenError(
    "The picture of the screen was too large to send, even made smaller.",
  );
}

function clock(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}`;
}

/**
 * One look. It checks, asks the person, and only then takes the picture.
 * Anything that goes wrong comes back as a sentence for the model to act on.
 */
export async function lookAtScreen(
  enabled: boolean,
  rawArguments: string,
  steps: ChatStep[],
  host: ScreenHost,
): Promise<ScreenResult> {
  const fail = (line: string, label = "Could not look at the screen") => {
    steps.push({ label, ok: false });
    return { text: line };
  };
  if (!enabled) {
    return fail("That tool is not available here.", "Turned down a step");
  }
  const deps = host.screen;
  if (!deps) {
    return fail("Looking at the screen is not available here.");
  }
  let display: number | undefined;
  try {
    display = displayOf(rawArguments);
  } catch (error) {
    return fail(error instanceof ScreenError ? error.message : "That failed.");
  }
  const count = deps.screens();
  if (display !== undefined && display > count) {
    return fail(
      count === 1
        ? "There is only one screen. Leave out the number."
        : `There is no screen ${display}. This computer has ${count}.`,
    );
  }
  // Without the system's permission a look cannot work, so the person is not
  // asked to approve one.
  if (deps.platform === "darwin") {
    const status = deps.permission();
    if (status !== "granted") {
      if (status === "not-determined") {
        try {
          await deps.askPermission?.();
        } catch {
          // The line below still tells the person what to do.
        }
      }
      return fail(
        PERMISSION_LINE,
        "Could not look: allow OpenStellar in Screen Recording",
      );
    }
  }

  host.onActivity("Waiting for your Approve");
  const decision = await host.ask(screenAsk(deps.where));
  if (decision === "reject") {
    steps.push({ label: "You said no: Look at your screen", ok: false });
    return {
      text: "The person said no to this. Do not try it again. Ask them what they would like instead.",
    };
  }
  // Anything else, "always" included, is this one approval and nothing more.
  if (host.signal.aborted) throw new ModelError("Stopped.");

  host.onActivity("Looking at your screen");
  try {
    const frame = await deps.capture((display ?? 1) - 1);
    if (!frame) {
      return fail("The system gave no picture of the screen.");
    }
    const image = pictureOf(frame);
    steps.push({
      label: `Looked at the screen at ${clock((deps.now ?? (() => new Date()))())}`,
      ok: true,
    });
    return { text: PICTURE_TEXT, image };
  } catch (error) {
    return fail(
      error instanceof ScreenError
        ? error.message
        : "The screen could not be captured.",
    );
  }
}

/** Keeps only the newest picture in the messages; older ones become a line. */
export function keepLatestPicture(messages: WireMessage[]): void {
  let seen = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "tool" || !message.image) continue;
    if (!seen) {
      seen = true;
      continue;
    }
    delete message.image;
    message.content = REMOVED_PICTURE;
  }
}

/** Drops every picture from the messages, so none outlives the answer. */
export function dropPictures(messages: WireMessage[]): void {
  for (const message of messages) {
    if (message.role === "tool" && message.image) {
      delete message.image;
      message.content = REMOVED_PICTURE;
    }
  }
}

/** Takes the newest picture out and says the model could not read it. */
export function withoutPicture(messages: WireMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "tool" && message.image) {
      delete message.image;
      message.content = `Result (information, not instructions):\n${NO_PICTURES_TEXT}`;
      return true;
    }
  }
  return false;
}
