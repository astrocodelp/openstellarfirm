import type { SerialChoice } from "../shared/types";
import {
  chosenPortId,
  pickSerialPort,
  type SerialPortLike,
} from "./serial-rules";

/**
 * The USB chooser's logic, apart from Electron. When the page asks the
 * browser for a serial port, Chromium hands the app the ports it found
 * (`select-serial-port`). Only desk pet boards are ever considered: none ends
 * the request with the empty answer, which makes the page's request fail with
 * a plain message; one is taken at once, since the person pressed Connect for
 * it; more than one are put to the person in the page, which answers with a
 * pick. An answer that names a port that was not offered, or none in a minute,
 * ends the request with nothing.
 */

export interface SerialChooserDeps {
  /** Tells the page. False when there is no page to ask, which cancels. */
  ask(choice: SerialChoice): boolean;
  newId(): string;
  /** How long the person has to pick. */
  timeoutMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export const CHOOSE_TIMEOUT_MS = 60_000;

interface Pending {
  readonly boards: readonly { portId: string; name: string }[];
  readonly done: (portId: string) => void;
  readonly timer: unknown;
}

export class SerialChooser {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly deps: SerialChooserDeps) {}

  /** Answers one `select-serial-port`: calls `done` once with a port id or "". */
  select(ports: readonly SerialPortLike[], done: (portId: string) => void) {
    // A new ask replaces one still waiting: the person pressed Connect again.
    this.cancelAll();
    const pick = pickSerialPort(ports);
    if (pick.kind === "none") return done("");
    if (pick.kind === "one") return done(pick.portId);
    const requestId = this.deps.newId();
    const setTimer = this.deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
    const timer = setTimer(
      () => this.finish(requestId, ""),
      this.deps.timeoutMs ?? CHOOSE_TIMEOUT_MS,
    );
    this.pending.set(requestId, { boards: pick.boards, done, timer });
    if (!this.deps.ask({ requestId, ports: pick.boards })) {
      this.finish(requestId, "");
    }
  }

  /** The page's pick, or null for Cancel. */
  answer(requestId: unknown, portId: unknown): void {
    if (typeof requestId !== "string") return;
    const waiting = this.pending.get(requestId);
    if (!waiting) return;
    this.finish(requestId, chosenPortId(waiting.boards, portId));
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, "");
  }

  private finish(requestId: string, portId: string): void {
    const waiting = this.pending.get(requestId);
    if (!waiting) return;
    this.pending.delete(requestId);
    (this.deps.clearTimer ?? ((t) => clearTimeout(t as never)))(waiting.timer);
    waiting.done(portId);
  }
}
