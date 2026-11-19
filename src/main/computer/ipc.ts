import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ComputerHold,
  ComputerInput,
  ComputerProgress,
  ComputerShot,
  ComputerView,
} from "../../shared/computer";
import { type Assistant, IPC } from "../../shared/types";
import { ComputerError, computerIds } from "./args";
import { dockerEnv, findDocker } from "./find";
import { spawnRunner } from "./runner";
import { ComputerService } from "./service";

/**
 * The computer's side of the bridge: the calls the page may make, each
 * checked here. The page sends an assistant's id and plain values; it never
 * names a path, a container, an image or an argument for Docker.
 */

/** The files the image is built from, shipped beside the bundle. */
export const IMAGE_FILES = [
  "Dockerfile",
  "start.sh",
  "screenshot.sh",
  "open-app.sh",
  "background.py",
  "firefox-policies.json",
] as const;

/** The live view's picture, at most. */
const MAX_VIEW_BYTES = 2_000_000;

export function createComputers(
  dataDir: string,
  imageDir: string,
): ComputerService {
  const where = {
    platform: process.platform,
    env: process.env,
    home: homedir(),
  };
  return new ComputerService({
    dataDir,
    ids: computerIds(process.platform, process.getuid?.(), process.getgid?.()),
    docker: () => {
      const path = findDocker({
        ...where,
        isFile: (p) => {
          try {
            return statSync(p).isFile();
          } catch {
            return false;
          }
        },
      });
      return path ? spawnRunner(path, dockerEnv(where, path)) : undefined;
    },
    imageFiles: () =>
      IMAGE_FILES.map((name) => ({
        name,
        content: readFileSync(join(imageDir, name), "utf8"),
      })),
  });
}

const HOLDS: ComputerHold[] = ["none", "paused", "taken"];

/** Reads one input from the page, or throws. Values are checked again in the service. */
export function cleanInput(raw: unknown): ComputerInput {
  if (typeof raw !== "object" || raw === null)
    throw new Error("That is not allowed.");
  const value = raw as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) ? v : Number.NaN;
  if (value.kind === "click") {
    const button = value.button;
    if (button !== "left" && button !== "right" && button !== "middle")
      throw new Error("That is not allowed.");
    return { kind: "click", x: num(value.x), y: num(value.y), button };
  }
  if (value.kind === "key" && typeof value.key === "string")
    return { kind: "key", key: value.key.slice(0, 40) };
  if (value.kind === "type" && typeof value.text === "string")
    return { kind: "type", text: value.text.slice(0, 200) };
  if (value.kind === "scroll") {
    const d = value.direction;
    if (d !== "up" && d !== "down" && d !== "left" && d !== "right")
      throw new Error("That is not allowed.");
    return {
      kind: "scroll",
      x: num(value.x),
      y: num(value.y),
      direction: d,
      amount: num(value.amount),
    };
  }
  throw new Error("That is not allowed.");
}

export interface ComputerIpc {
  handle(
    channel: string,
    run: (event: unknown, ...args: never[]) => unknown,
  ): void;
  service: ComputerService;
  /** The assistant by id; throws when it is not there. */
  assistant(id: unknown): Assistant;
  progress(payload: ComputerProgress): void;
  openFolder(path: string): Promise<string>;
}

/**
 * Runs the person's inputs for each assistant one after another. Each key is
 * a call of its own, and calls made at once would reach the computer in any
 * order: "abc" typed fast could arrive as "cba".
 */
export function inputLanes(): (
  id: string,
  run: () => Promise<void>,
) => Promise<void> {
  const lanes = new Map<string, Promise<void>>();
  return (id, run) => {
    const next = (lanes.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
    lanes.set(id, next);
    void next
      .finally(() => {
        if (lanes.get(id) === next) lanes.delete(id);
      })
      .catch(() => {});
    return next;
  };
}

export function registerComputer(ipc: ComputerIpc): void {
  const { handle, service } = ipc;
  const inOrder = inputLanes();
  const view = (id: unknown): Promise<ComputerView> =>
    service.view(ipc.assistant(id));
  handle(IPC.computerStatus, () => service.status());
  handle(IPC.computerSetup, async () => {
    // Lines arrive fast while it builds; the page gets one every quarter second.
    let last = 0;
    let held: string | undefined;
    try {
      await service.setup((line) => {
        held = line.slice(0, 300);
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        ipc.progress({ line: held, state: "running" });
        held = undefined;
      });
      ipc.progress({ line: "The computer is set up.", state: "done" });
    } catch (error) {
      ipc.progress({
        line:
          error instanceof ComputerError
            ? error.message
            : "The computer could not be set up.",
        state: "failed",
      });
      throw error;
    }
  });
  handle(IPC.computerView, (_e, id: unknown) => view(id));
  handle(IPC.computerStart, async (_e, id: unknown) => {
    const assistant = ipc.assistant(id);
    await service.ensure(assistant);
    return service.view(assistant);
  });
  handle(
    IPC.computerShot,
    async (_e, id: unknown): Promise<ComputerShot | null> => {
      const assistant = ipc.assistant(id);
      try {
        const shot = await service.screenshot(
          assistant.id,
          "jpg",
          MAX_VIEW_BYTES,
        );
        return {
          src: `data:${shot.mediaType};base64,${Buffer.from(shot.bytes).toString("base64")}`,
          at: new Date().toISOString(),
        };
      } catch {
        // Off, or not ready yet: the panel says so.
        return null;
      }
    },
  );
  handle(IPC.computerHold, (_e, id: unknown, hold: unknown) => {
    const assistant = ipc.assistant(id);
    const next = HOLDS.find((h) => h === hold);
    if (!next) throw new Error("That is not allowed.");
    service.setHold(assistant.id, next);
    return service.view(assistant);
  });
  handle(IPC.computerInput, (_e, id: unknown, raw: unknown) => {
    const assistant = ipc.assistant(id);
    const input = cleanInput(raw);
    return inOrder(assistant.id, async () => {
      // The person's clicks and keys reach the computer only while they hold
      // it, checked when each one's turn comes: a key still waiting when they
      // give it back is not sent.
      if (service.holdOf(assistant.id) !== "taken")
        throw new Error("Take over first.");
      if (input.kind === "click")
        await service.click(assistant.id, input.x, input.y, input.button);
      else if (input.kind === "key") await service.key(assistant.id, input.key);
      else if (input.kind === "type")
        await service.type(assistant.id, input.text);
      else
        await service.scroll(
          assistant.id,
          input.x,
          input.y,
          input.direction,
          input.amount,
        );
    });
  });
  handle(IPC.computerStop, async (_e, id: unknown) => {
    const assistant = ipc.assistant(id);
    service.setHold(assistant.id, "none");
    await service.stop(assistant.id);
    return service.view(assistant);
  });
  handle(IPC.computerRemove, async (_e, id: unknown) => {
    const assistant = ipc.assistant(id);
    await service.remove(assistant.id);
    return service.view(assistant);
  });
  handle(IPC.computerOpenExchange, async (_e, id: unknown) => {
    const assistant = ipc.assistant(id);
    const problem = await ipc.openFolder(service.exchangeFolder(assistant.id));
    if (problem) throw new Error("The folder could not be opened.");
  });
}
