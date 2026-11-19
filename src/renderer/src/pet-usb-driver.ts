import type { DeskPetSetupCode, DeskPetsStatus } from "../../shared/desk-pets";
import type { PetKind } from "../../shared/pets/kinds";
import {
  createPetUsbLineSplitter,
  decodePetUsb2Reply,
  encodePetUsb2Request,
  isPetUsbIpv4,
  isPetUsbIpv6,
  isPetUsbServerName,
  PET_USB_BAUD,
  PET_USB_PRODUCT_ID,
  PET_USB_VENDOR_ID,
  type PetUsb2Reply,
  type PetUsbError,
  type PetUsbField,
  PetUsbFormatError,
  type PetUsbServer,
  type PetUsbState,
  petUsbSpeaksV2,
  petUsbWire,
} from "../../shared/pets/usb";

/**
 * Sets a desk pet up over its USB cable, from the page. This file is the one
 * place the Wi-Fi password is held, and it hands the password to exactly one
 * thing: the cable (`PetLink.write`). It is never given to the app's main
 * process (the only app call it may make, `petsStartAdding`, takes and returns
 * no Wi-Fi value), never stored, never logged and never part of a message or
 * an error. The state machine has no way to reach the other end of a cable that
 * is not a v2 pet: a pet that answers with version 1 is told to update and is
 * sent nothing else.
 *
 * The page's own pieces (React, `navigator.serial`) stay outside, behind the
 * `PetLink` port, so this module runs in a plain test.
 */

/** A cable to one pet. The page's Web Serial port is one; a test's is another. */
export interface PetLink {
  write(bytes: Uint8Array): Promise<void>;
  /** Calls the listener with each chunk the pet sends. Returns a way to stop. */
  onData(listener: (chunk: Uint8Array) => void): () => void;
  /** Calls the listener once if the cable goes away (unplugged, port closed). */
  onClose(listener: () => void): () => void;
  close(): Promise<void>;
}

/** The only calls to the app this module may make. Neither carries a Wi-Fi value. */
export interface PairingApi {
  petsStartAdding(): Promise<DeskPetSetupCode>;
}

export interface DriverOptions {
  /** How long to wait for one answer to a line. */
  replyTimeoutMs?: number;
  /** How long a whole setup try may take before the page gives up. */
  tryTimeoutMs?: number;
  /** How many times `hello` is sent before the pet counts as silent. */
  helloAttempts?: number;
}

export const REPLY_TIMEOUT_MS = 3_000;
export const TRY_TIMEOUT_MS = 120_000;
export const HELLO_ATTEMPTS = 3;

export type HelloResult =
  | {
      readonly outcome: "ready";
      readonly kind: PetKind;
      readonly firmware: string;
    }
  | {
      /** A v1 pet: nothing but `hello` was sent, and nothing else will be. */
      readonly outcome: "needs-update";
      readonly kind: PetKind;
      readonly firmware: string;
    }
  | { readonly outcome: "already-paired"; readonly kind: PetKind }
  | { readonly outcome: "no-answer" }
  | { readonly outcome: "unplugged" };

export type PairResult =
  /** The pet joined the Wi-Fi and asked the app to pair: it says its code now. */
  | { readonly outcome: "confirm" }
  /** A value was not allowed; nothing was sent. The message names the field only. */
  | {
      readonly outcome: "invalid";
      readonly field: PetUsbField;
      readonly message: string;
    }
  /** No v2 hello came first, so nothing was sent. */
  | { readonly outcome: "not-ready"; readonly message: string }
  | {
      readonly outcome: "refused";
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly outcome: "failed";
      readonly error: PetUsbError;
      readonly message: string;
    }
  | { readonly outcome: "setup-code"; readonly message: string }
  | { readonly outcome: "unplugged"; readonly message: string }
  | { readonly outcome: "timed-out"; readonly message: string };

/** What the owner is told when the pet turns a line away. Plain, no values. */
export const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  paired:
    "This pet is already set up. Hold its light for 10 seconds while it starts to set it up again, or forget it first.",
  busy: "The pet is still busy with an earlier try. Wait a moment and try again.",
  bad_value:
    "The pet did not accept the values. Check the Wi-Fi name and password.",
  bad_line:
    "The pet did not understand the app. Update the app and the pet's firmware.",
  unknown_op:
    "The pet did not understand the app. Update the app and the pet's firmware.",
  rate_limited: "The pet got too many messages at once. Try again.",
  not_ready: "The pet was not ready. Unplug it, plug it in and try again.",
};

/** What the owner is told when the pet's try ends in an error. */
export const FAILURE_TEXT: Readonly<Record<PetUsbError, string>> = {
  wifi_failed:
    "The pet could not join that Wi-Fi. Check the name and password, and that it is a 2.4 GHz network.",
  code_refused:
    "OpenStellarFirm did not accept the setup code. Start again to make a new one.",
  unreachable:
    "The pet joined the Wi-Fi but could not reach OpenStellarFirm on this computer. Check that Desk pets are on, and that your firewall lets the app accept connections on your home network.",
  timed_out: "The pet ran out of time. Try again.",
  save_failed: "The pet could not save its settings. Try again.",
};

/** The computer, as the pet is told to find it, or why that cannot be done. */
export type ServerTarget =
  | { readonly ok: true; readonly server: PetUsbServer }
  | { readonly ok: false; readonly message: string };

/**
 * What to tell the pet about this computer, from the app's status: the first
 * private IPv4 address (else the first IPv6 one, else none, and the pet asks
 * for the name), the port, the certificate's fingerprint and the mDNS name.
 * None of it is secret.
 */
export function serverTarget(status: DeskPetsStatus): ServerTarget {
  if (!status.enabled || !status.running || status.port === null) {
    return {
      ok: false,
      message:
        "Desk pets are not running on this computer. Turn them on first.",
    };
  }
  if (status.fingerprint === null) {
    return {
      ok: false,
      message: "The app has no certificate for desk pets yet. Try again.",
    };
  }
  if (!isPetUsbServerName(status.mdnsName)) {
    return {
      ok: false,
      message: "The app's name on your network is not ready. Try again.",
    };
  }
  const address =
    status.addresses.find((a) => isPetUsbIpv4(a)) ??
    status.addresses.find((a) => isPetUsbIpv6(a.toLowerCase())) ??
    null;
  return {
    ok: true,
    server: {
      address: address === null ? null : address.toLowerCase(),
      port: status.port,
      fingerprint: status.fingerprint,
      name: status.mdnsName,
    },
  };
}

type Settle = (reply: PetUsb2Reply | "closed") => boolean;

export interface PairInput {
  /** What the owner typed. Held only for the call; written to the cable and nowhere else. */
  readonly ssid: string;
  readonly password: string;
  readonly server: PetUsbServer;
  /** Told each state the pet reports: joining, pairing, confirm. Fixed words. */
  readonly onState?: (state: PetUsbState) => void;
}

/** One cable, one setup. */
export class PetUsbSession {
  private readonly splitter = createPetUsbLineSplitter();
  private readonly queue: PetUsb2Reply[] = [];
  private waiter: { settle: Settle; done: () => void } | null = null;
  private closed = false;
  private ready = false;
  private readonly stop: (() => void)[] = [];
  private readonly replyMs: number;
  private readonly tryMs: number;
  private readonly helloAttempts: number;

  constructor(
    private readonly link: PetLink,
    options: DriverOptions = {},
  ) {
    this.replyMs = options.replyTimeoutMs ?? REPLY_TIMEOUT_MS;
    this.tryMs = options.tryTimeoutMs ?? TRY_TIMEOUT_MS;
    this.helloAttempts = options.helloAttempts ?? HELLO_ATTEMPTS;
    this.stop.push(
      link.onData((chunk) => {
        for (const piece of this.splitter.push(chunk)) {
          if (piece.kind !== "line") continue;
          const reply = decodePetUsb2Reply(piece.line);
          if (reply !== null) this.take(reply);
        }
      }),
      link.onClose(() => {
        this.closed = true;
        this.waiter?.settle("closed");
      }),
    );
  }

  private take(reply: PetUsb2Reply): void {
    if (this.waiter?.settle(reply)) return;
    this.queue.push(reply);
  }

  /** The first reply `accept` takes; others are dropped. Null on a timeout. */
  private wait(
    accept: (reply: PetUsb2Reply) => boolean,
    ms: number,
  ): Promise<PetUsb2Reply | "closed" | null> {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next && accept(next)) return Promise.resolve(next);
    }
    if (this.closed) return Promise.resolve("closed");
    return new Promise((resolve) => {
      const finish = (value: PetUsb2Reply | "closed" | null) => {
        clearTimeout(timer);
        this.waiter = null;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), ms);
      this.waiter = {
        settle: (reply) => {
          if (reply !== "closed" && !accept(reply)) return false;
          finish(reply);
          return true;
        },
        done: () => finish(null),
      };
    });
  }

  private async send(line: string): Promise<void> {
    // Whatever the pet said before this line is not an answer to it.
    this.queue.length = 0;
    await this.link.write(petUsbWire(line));
  }

  /**
   * Asks the pet who it is. A pet that does not answer `hello` as version 2 or
   * later is a v1 pet (or not a pet): the result says so and the session sends
   * it nothing more.
   */
  async hello(): Promise<HelloResult> {
    this.ready = false;
    for (let attempt = 0; attempt < this.helloAttempts; attempt += 1) {
      await this.send(encodePetUsb2Request({ op: "hello" }));
      const reply = await this.wait((r) => r.type === "hello", this.replyMs);
      if (reply === "closed") return { outcome: "unplugged" };
      if (reply === null || reply.type !== "hello") continue;
      if (reply.paired) return { outcome: "already-paired", kind: reply.kind };
      if (!petUsbSpeaksV2(reply)) {
        return {
          outcome: "needs-update",
          kind: reply.kind,
          firmware: reply.firmware,
        };
      }
      this.ready = true;
      return { outcome: "ready", kind: reply.kind, firmware: reply.firmware };
    }
    return { outcome: "no-answer" };
  }

  /**
   * Stages the computer's address, pin and name, then the Wi-Fi, then starts
   * the try with a fresh setup code, and waits until the pet reaches
   * `confirm` (it says its code aloud) or fails. Every line is checked first,
   * so a bad value sends nothing and burns no setup code.
   */
  async pair(input: PairInput, api: PairingApi): Promise<PairResult> {
    if (!this.ready) {
      return {
        outcome: "not-ready",
        message: "Connect to the pet first.",
      };
    }
    let serverLine: string;
    let wifiLine: string;
    try {
      serverLine = encodePetUsb2Request({ op: "server", ...input.server });
      wifiLine = encodePetUsb2Request({
        op: "wifi",
        ssid: input.ssid,
        password: input.password,
      });
    } catch (error) {
      return invalid(error);
    }
    let setup: DeskPetSetupCode;
    try {
      setup = await api.petsStartAdding();
    } catch (error) {
      return {
        outcome: "setup-code",
        message:
          error instanceof Error
            ? error.message
            : "The app could not make a setup code.",
      };
    }
    let startLine: string;
    try {
      startLine = encodePetUsb2Request({
        op: "start",
        setupCode: setup.code,
      });
    } catch (error) {
      return invalid(error);
    }

    const deadline = Date.now() + this.tryMs;
    for (const [line, op] of [
      [serverLine, "server"],
      [wifiLine, "wifi"],
      [startLine, "start"],
    ] as const) {
      await this.send(line);
      const reply = await this.wait(
        (r) => (r.type === "ok" && r.op === op) || r.type === "refused",
        this.replyMs,
      );
      if (reply === "closed") return unplugged();
      if (reply === null) return timedOut();
      if (reply.type === "refused") return refusedBy(reply.reason);
    }

    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) return timedOut();
      const reply = await this.wait(
        (r) => r.type === "state" || r.type === "refused",
        left,
      );
      if (reply === "closed") return unplugged();
      if (reply === null) return timedOut();
      if (reply.type === "refused") return refusedBy(reply.reason);
      if (reply.type !== "state") continue;
      if (reply.state === "error") {
        return {
          outcome: "failed",
          error: reply.error,
          message: FAILURE_TEXT[reply.error],
        };
      }
      input.onState?.(reply.state);
      if (reply.state === "confirm" || reply.state === "done") {
        return { outcome: "confirm" };
      }
    }
  }

  /** Asks a try under way to stop. Best effort: the cable may be gone. */
  async cancel(): Promise<void> {
    if (this.closed) return;
    try {
      await this.send(encodePetUsb2Request({ op: "cancel" }));
    } catch {
      // The cable is gone; there is nothing more to do.
    }
  }

  /** Lets go of the cable. */
  async close(): Promise<void> {
    for (const stop of this.stop.splice(0)) stop();
    this.waiter?.done();
    this.closed = true;
    await this.link.close().catch(() => undefined);
  }
}

function invalid(error: unknown): PairResult {
  if (error instanceof PetUsbFormatError) {
    return {
      outcome: "invalid",
      field: error.field,
      message: fieldText(error.field),
    };
  }
  return { outcome: "invalid", field: "line", message: fieldText("line") };
}

/** One sentence for a value the pet's rules refuse. It never repeats the value. */
export function fieldText(field: PetUsbField): string {
  switch (field) {
    case "ssid":
      return "The Wi-Fi name must be 1 to 32 characters.";
    case "password":
      return "The Wi-Fi password must be 8 to 63 characters, or empty for a network with no password.";
    case "setupCode":
      return "The setup code was not valid. Try again.";
    case "server":
      return "OpenStellarFirm could not describe this computer to the pet. Try again.";
    default:
      return "Something in the setup was not valid. Try again.";
  }
}

function refusedBy(reason: string): PairResult {
  return {
    outcome: "refused",
    reason,
    message: REFUSAL_TEXT[reason] ?? "The pet did not accept that. Try again.",
  };
}

function unplugged(): PairResult {
  return {
    outcome: "unplugged",
    message: "The cable was unplugged. Plug the pet in and start again.",
  };
}

function timedOut(): PairResult {
  return {
    outcome: "timed-out",
    message:
      "The pet did not answer in time. Unplug it, plug it in and try again.",
  };
}

// -- Web Serial ---------------------------------------------------------------

/** What of Web Serial this page uses. */
interface SerialPortApi {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}

interface SerialApi {
  requestPort(options: {
    filters: { usbVendorId: number; usbProductId: number }[];
  }): Promise<SerialPortApi>;
}

/** Whether this window can talk to a USB serial device at all. */
export function webSerialAvailable(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

/**
 * Asks for the pet's USB port (the app's main process shows its chooser when
 * several pets are plugged in) and opens it. Never opens at 1200 baud: that
 * rate is how a computer asks some boards to restart in their loader.
 */
export async function openPetLink(): Promise<PetLink> {
  const serial = (navigator as unknown as { serial?: SerialApi }).serial;
  if (!serial) throw new Error("This window cannot use a USB cable.");
  const port = await serial.requestPort({
    filters: [
      { usbVendorId: PET_USB_VENDOR_ID, usbProductId: PET_USB_PRODUCT_ID },
    ],
  });
  await port.open({ baudRate: PET_USB_BAUD });
  const { readable, writable } = port;
  if (!readable || !writable) {
    await port.close().catch(() => undefined);
    throw new Error("The pet's USB port could not be opened.");
  }
  const reader = readable.getReader();
  const writer = writable.getWriter();
  const dataListeners = new Set<(chunk: Uint8Array) => void>();
  const closeListeners = new Set<() => void>();
  let closing = false;

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) for (const listener of dataListeners) listener(value);
      }
    } catch {
      // Unplugged or closed: told below.
    }
    if (!closing) for (const listener of closeListeners) listener();
  })();

  return {
    write: (bytes) => writer.write(bytes),
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    async close() {
      closing = true;
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      await writer.close().catch(() => undefined);
      writer.releaseLock();
      await port.close().catch(() => undefined);
    },
  };
}

/** The sentence for a request for the USB port that did not give one. */
export function connectProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotFoundError") {
    return "No desk pet was found on a USB cable. Plug it in, wait a few seconds and try again. If it is plugged in, try another cable: some only charge.";
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return "This window is not allowed to use the USB cable.";
  }
  if (name === "InvalidStateError" || name === "NetworkError") {
    return "The pet's USB port is busy or could not be opened. Close other programs that use it, unplug the pet and try again.";
  }
  return "The pet could not be reached over USB.";
}
