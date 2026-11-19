import { normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PET_USB_PRODUCT_ID, PET_USB_VENDOR_ID } from "../shared/pets/usb";
import type { SerialChoiceItem } from "../shared/types";

/**
 * What the app's page may ask of USB, kept apart from Electron so it is tested
 * offline. The page needs one thing: Web Serial, to talk to a desk pet's
 * Arduino Nano ESP32 while it is being set up. So the one permission the
 * window gets is `serial`, only for the app's own page in its main frame, and
 * the only device it may see or open is a board with the Nano ESP32's own USB
 * identity. Everything else is still refused by the callers.
 */

export interface SerialPageRules {
  /** The address of the app's page (a file: address). */
  pageUrl: string;
  /** The dev server, only when the app runs from source. */
  devUrl: string | undefined;
  packaged: boolean;
}

/** Whether a url is the app's own page: the file, or (from source) the dev server. */
export function isOwnPage(
  url: string | undefined,
  rules: SerialPageRules,
): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "file:") {
    try {
      return (
        normalize(fileURLToPath(parsed)) ===
        normalize(fileURLToPath(rules.pageUrl))
      );
    } catch {
      return false;
    }
  }
  if (rules.packaged || !rules.devUrl) return false;
  try {
    return parsed.origin === new URL(rules.devUrl).origin;
  } catch {
    return false;
  }
}

export interface SerialPermissionAsk {
  permission: string;
  /** Where the ask came from, as Electron reports it. */
  requestingUrl: string | undefined;
  /** False for a frame inside the page. Absent is taken as false: closed. */
  isMainFrame: boolean | undefined;
  /** Whether the ask came from the app's main window, not the hidden reader. */
  fromMainWindow: boolean;
}

/** True only for `serial`, from the main window's own page, in its main frame. */
export function serialPermissionAllowed(
  ask: SerialPermissionAsk,
  rules: SerialPageRules,
): boolean {
  return (
    ask.permission === "serial" &&
    ask.fromMainWindow &&
    ask.isMainFrame === true &&
    isOwnPage(ask.requestingUrl, rules)
  );
}

/** What Electron says about a serial port; ids come as numbers or as strings. */
export interface SerialPortLike {
  portId?: string;
  portName?: string;
  displayName?: string;
  vendorId?: string | number;
  productId?: string | number;
}

/** A USB id as a number: a number, a decimal string or a 0x hex string. */
function idOf(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value !== "string" || value === "") return null;
  if (/^0x[0-9a-f]{1,4}$/i.test(value)) return Number.parseInt(value, 16);
  if (/^[0-9]{1,5}$/.test(value)) return Number(value);
  return null;
}

/** True for the Arduino Nano ESP32's own USB identity, and nothing else. */
export function isPetBoard(port: SerialPortLike | undefined): boolean {
  if (!port) return false;
  return (
    idOf(port.vendorId) === PET_USB_VENDOR_ID &&
    idOf(port.productId) === PET_USB_PRODUCT_ID
  );
}

/** The device permission handler's whole rule: a serial device that is a pet board. */
export function serialDeviceAllowed(details: {
  deviceType: string;
  device: SerialPortLike | unknown;
}): boolean {
  return (
    details.deviceType === "serial" &&
    isPetBoard(details.device as SerialPortLike)
  );
}

/** The boards among the ports Chromium listed, named for the chooser. */
export function petBoards(
  ports: readonly SerialPortLike[],
): SerialChoiceItem[] {
  const boards: SerialChoiceItem[] = [];
  for (const port of ports) {
    if (typeof port.portId !== "string" || port.portId === "") continue;
    if (!isPetBoard(port)) continue;
    const name = port.displayName || port.portName || "Desk pet";
    boards.push({ portId: port.portId, name });
  }
  return boards;
}

/** What to do with the list: nothing found, the one board, or ask the owner. */
export type SerialPick =
  | { kind: "none" }
  | { kind: "one"; portId: string }
  | { kind: "many"; boards: SerialChoiceItem[] };

export function pickSerialPort(ports: readonly SerialPortLike[]): SerialPick {
  const boards = petBoards(ports);
  if (boards.length === 0) return { kind: "none" };
  const [only] = boards;
  if (boards.length === 1 && only) return { kind: "one", portId: only.portId };
  return { kind: "many", boards };
}

/** The owner's answer is taken only if it names a board that was offered. */
export function chosenPortId(
  boards: readonly SerialChoiceItem[],
  answer: unknown,
): string {
  if (typeof answer !== "string") return "";
  return boards.some((b) => b.portId === answer) ? answer : "";
}
