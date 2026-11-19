import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ComputerHold,
  type ComputerSettings,
  type ComputerStatus,
  type ComputerView,
  type MouseButton,
  normalizeKey,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type ScrollDirection,
} from "../../shared/computer";
import {
  buildArgs,
  ComputerError,
  configKey,
  containerName,
  execArgs,
  HOME,
  imageTag,
  inspectArgs,
  LIST_RUNNING_ARGS,
  runArgs,
  type UserIds,
} from "./args";
import type { Runner, RunResult } from "./runner";

/**
 * Each assistant's own computer, kept by the main process. Every call to
 * Docker goes through the runner with an argument array, and every value
 * that came from a model is checked here before it becomes one argument.
 */

export const MAX_TYPE_CHARS = 2000;
export const MAX_COMMAND_CHARS = 4000;
export const MAX_RUN_SECONDS = 300;
export const DEFAULT_RUN_SECONDS = 60;
/** Each of standard output and standard error, in characters. */
export const MAX_OUTPUT_CHARS = 12_000;
export const MAX_COPY_BYTES = 25 * 1024 * 1024;
export const MAX_SCROLL = 10;
/** start.sh makes this file once the screen and its window manager are ready. */
export const READY_FILE = "/tmp/.computer-ready";

// The pointer is moved without "--sync": on a virtual screen the move and
// the click arrive in order, and "--sync" waits a long time when the pointer
// is already at that point.
const BUTTONS: Record<MouseButton, string> = {
  left: "1",
  middle: "2",
  right: "3",
};
const SCROLL_BUTTONS: Record<ScrollDirection, string> = {
  up: "4",
  down: "5",
  left: "6",
  right: "7",
};

export interface Assistantish {
  id: string;
  computer?: ComputerSettings | undefined;
}

export interface ComputerDeps {
  /** Finds the `docker` program and makes a runner for it; none when missing. */
  docker(): Runner | undefined;
  /** The app's data folder. Exchange folders are made under it. */
  dataDir: string;
  /** The files the image is built from, as the app ships them. */
  imageFiles(): { name: string; content: string }[];
  /** The ids the computer's user is made with; 1000 when not given. */
  ids?: UserIds;
  sleep?(ms: number): Promise<void>;
}

/** The first line of what Docker said, cut short, or a plain sentence. */
function said(result: RunResult, fallback: string): string {
  if (
    /Cannot connect to the Docker daemon|error during connect/i.test(
      result.stderr,
    )
  )
    return "Docker is not running. Start it, then try again.";
  const line = result.stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return line ? `${fallback} Docker said: ${line.slice(0, 200)}` : fallback;
}

function check(value: unknown, max: number, what: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= max
  )
    throw new ComputerError(
      `${what} must be a whole number from 0 to ${max - 1}.`,
    );
  return value;
}

/** A path inside the computer, as a model wrote it. */
export function insidePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim())
    throw new ComputerError("Name the file's path on the computer.");
  const typed = raw.trim();
  if (typed.length > 1024 || /[\0\r\n]/.test(typed))
    throw new ComputerError("That is not a path on the computer.");
  // No shell reads the path, so "~" is turned into the home folder here, as
  // a model writes it the way the shell would take it.
  if (typed === "~") return HOME;
  return typed.startsWith("~/") ? `${HOME}/${typed.slice(2)}` : typed;
}

/** A safe name for a file in the exchange folder, from the last part of a path. */
export function exchangeName(path: string): string {
  const last = path.split("/").filter(Boolean).at(-1) ?? "";
  const clean = last
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/^[.\s]+/, "")
    .slice(0, 100)
    .trim();
  return clean || "file";
}

function withNumber(name: string, n: number): string {
  if (n === 1) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
    : `${name} (${n})`;
}

export interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when some output was cut. */
  cut: boolean;
}

/** How many times the person has turned a computer off or removed it. */
export interface ComputerEnded {
  count: number;
  removed: boolean;
}

export class ComputerService {
  private building = false;
  private imageReady: string | undefined;
  private readonly holds = new Map<
    string,
    { mode: ComputerHold; waiters: Set<() => void> }
  >();
  private readonly starting = new Map<string, Promise<void>>();
  /** Each computer the person turned off or removed, how often and how last. */
  private readonly ended = new Map<string, ComputerEnded>();
  /** True once a computer was started in this run of the app. */
  private touched = false;

  constructor(private readonly deps: ComputerDeps) {}

  private runner(): Runner {
    const run = this.deps.docker();
    if (!run)
      throw new ComputerError(
        "Docker is not on this computer. Install Docker, then try again.",
      );
    return run;
  }

  private tag(): string {
    return imageTag(this.deps.imageFiles(), this.deps.ids);
  }

  async status(): Promise<ComputerStatus> {
    const run = this.deps.docker();
    if (!run) return { docker: "missing", image: false, building: false };
    let version: RunResult;
    try {
      version = await run(["version", "--format", "{{.Server.Version}}"], {
        timeoutMs: 8000,
      });
    } catch {
      return { docker: "missing", image: false, building: false };
    }
    const text = Buffer.from(version.stdout).toString("utf8").trim();
    if (version.code !== 0 || !text)
      return { docker: "stopped", image: false, building: this.building };
    return {
      docker: "ready",
      version: text.slice(0, 40),
      image: await this.hasImage(),
      building: this.building,
    };
  }

  private async hasImage(): Promise<boolean> {
    const tag = this.tag();
    if (this.imageReady === tag) return true;
    const result = await this.runner()(
      ["image", "inspect", "--format", "{{.Id}}", tag],
      { timeoutMs: 8000 },
    );
    if (result.code === 0) this.imageReady = tag;
    return result.code === 0;
  }

  /**
   * Builds the image from the files the app ships: the base image and the
   * packages are downloaded. Only the person's click calls this.
   */
  async setup(onLine: (line: string) => void): Promise<void> {
    if (this.building) throw new ComputerError("It is being set up already.");
    const run = this.runner();
    this.building = true;
    try {
      const dir = join(this.deps.dataDir, "computer-image");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const files = this.deps.imageFiles();
      for (const file of files) {
        if (!/^[\w.-]+$/.test(file.name))
          throw new ComputerError("The computer's files are not as shipped.");
        writeFileSync(join(dir, file.name), file.content, { mode: 0o644 });
      }
      const tag = imageTag(files, this.deps.ids);
      const result = await run(buildArgs(tag, dir, this.deps.ids), {
        timeoutMs: 30 * 60_000,
        maxBytes: 64 * 1024,
        onLine,
      });
      if (result.code !== 0)
        throw new ComputerError(
          said(result, "The computer could not be set up."),
        );
      this.imageReady = tag;
    } finally {
      this.building = false;
    }
  }

  /** The assistant's exchange folder, made on first use, private to this user. */
  exchangeFolder(assistantId: string): string {
    containerName(assistantId);
    const dir = join(this.deps.dataDir, "computers", assistantId, "exchange");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  private async inspect(
    assistantId: string,
  ): Promise<{ running: boolean; config: string } | undefined> {
    const result = await this.runner()(inspectArgs(assistantId), {
      timeoutMs: 8000,
    });
    if (result.code !== 0) return undefined;
    // The settings label holds "|" too, so only the first one splits.
    const text = Buffer.from(result.stdout).toString("utf8").trim();
    const cut = text.indexOf("|");
    return {
      running: (cut === -1 ? text : text.slice(0, cut)) === "true",
      config: cut === -1 ? "" : text.slice(cut + 1),
    };
  }

  async view(assistant: Assistantish): Promise<ComputerView> {
    const exchange = this.exchangeFolder(assistant.id);
    const found = this.deps.docker()
      ? await this.inspect(assistant.id).catch(() => undefined)
      : undefined;
    return {
      container: !found ? "none" : found.running ? "on" : "off",
      hold: this.holdOf(assistant.id),
      exchange,
    };
  }

  /**
   * Makes sure the computer runs with the settings it has now. A container
   * made with other settings is removed and made again: its network and its
   * limits cannot change while it exists. The exchange folder stays.
   */
  ensure(assistant: Assistantish): Promise<void> {
    const busy = this.starting.get(assistant.id);
    if (busy) return busy;
    const started = this.start(assistant).finally(() =>
      this.starting.delete(assistant.id),
    );
    this.starting.set(assistant.id, started);
    return started;
  }

  private async start(assistant: Assistantish): Promise<void> {
    const settings = assistant.computer;
    if (!settings)
      throw new ComputerError("This assistant has no computer turned on.");
    const run = this.runner();
    this.touched = true;
    if (!(await this.hasImage()))
      throw new ComputerError(
        "The computer is not set up yet. Press Set up the computer in its Computer panel.",
      );
    const image = this.tag();
    const want = configKey(settings, image);
    const name = containerName(assistant.id);
    const found = await this.inspect(assistant.id);
    if (found && found.config !== want) {
      await run(["rm", "--force", name], { timeoutMs: 30_000 });
    }
    if (found && found.config === want) {
      if (!found.running) {
        const result = await run(["start", name], { timeoutMs: 60_000 });
        if (result.code !== 0)
          throw new ComputerError(said(result, "The computer did not start."));
      }
    } else {
      const result = await run(
        runArgs({
          assistantId: assistant.id,
          image,
          exchange: this.exchangeFolder(assistant.id),
          settings,
          ids: this.deps.ids,
        }),
        { timeoutMs: 120_000 },
      );
      if (result.code !== 0)
        throw new ComputerError(said(result, "The computer did not start."));
    }
    await this.waitForScreen(assistant.id);
  }

  /**
   * Waits until the computer's start script has finished: the screen, the
   * window manager and their settings. A program opened before then would
   * get no window manager, so its window would not fill the screen.
   */
  private async waitForScreen(assistantId: string): Promise<void> {
    const sleep =
      this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (let i = 0; i < 40; i += 1) {
      const result = await this.runner()(
        execArgs(assistantId, ["test", "-e", READY_FILE]),
        { timeoutMs: 5000 },
      );
      if (result.code === 0) return;
      await sleep(250);
    }
    throw new ComputerError("The computer started, but its screen did not.");
  }

  private async exec(
    assistantId: string,
    command: string[],
    fallback: string,
    timeoutMs = 15_000,
  ): Promise<RunResult> {
    const result = await this.runner()(execArgs(assistantId, command), {
      timeoutMs,
    });
    if (result.code !== 0 || result.timedOut)
      throw new ComputerError(said(result, fallback));
    return result;
  }

  /** One picture of the screen. "png" for a model, "jpg" for the live view. */
  async screenshot(
    assistantId: string,
    format: "png" | "jpg",
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const result = await this.runner()(
      execArgs(assistantId, ["computer-screenshot", format]),
      { timeoutMs: 15_000, maxBytes },
    );
    if (result.code !== 0)
      throw new ComputerError(
        said(result, "The screen could not be captured."),
      );
    if (result.overflow)
      throw new ComputerError("The picture of the screen was too large.");
    return {
      bytes: result.stdout,
      mediaType: format === "png" ? "image/png" : "image/jpeg",
    };
  }

  async click(
    assistantId: string,
    x: unknown,
    y: unknown,
    button: MouseButton = "left",
    double = false,
  ): Promise<void> {
    const px = check(x, SCREEN_WIDTH, "x");
    const py = check(y, SCREEN_HEIGHT, "y");
    const which = BUTTONS[button];
    if (!which) throw new ComputerError("The button is left, right or middle.");
    await this.exec(
      assistantId,
      [
        "xdotool",
        "mousemove",
        String(px),
        String(py),
        "click",
        ...(double ? ["--repeat", "2"] : []),
        which,
      ],
      "The click did not work.",
    );
  }

  async type(assistantId: string, text: unknown): Promise<void> {
    if (typeof text !== "string" || !text)
      throw new ComputerError("Give the text to type.");
    if (text.length > MAX_TYPE_CHARS)
      throw new ComputerError(
        `That is too much text to type at once. Type at most ${MAX_TYPE_CHARS} characters.`,
      );
    // Control characters other than new lines and tabs are not typed.
    const clean = text.replace(/[^\P{Cc}\n\t]+/gu, "");
    if (!clean) throw new ComputerError("Give the text to type.");
    await this.exec(
      assistantId,
      ["xdotool", "type", "--delay", "12", "--", clean],
      "The typing did not work.",
      60_000,
    );
  }

  async key(assistantId: string, raw: unknown): Promise<string> {
    const key = normalizeKey(raw);
    if (!key)
      throw new ComputerError(
        "That key is not on the list. Use a name such as Enter, Tab, Escape, Backspace, Up, F5, or a combination such as ctrl+c.",
      );
    await this.exec(
      assistantId,
      ["xdotool", "key", "--clearmodifiers", "--", key],
      "The key press did not work.",
    );
    return key;
  }

  async scroll(
    assistantId: string,
    x: unknown,
    y: unknown,
    direction: unknown,
    amount: unknown = 3,
  ): Promise<void> {
    const px = check(x, SCREEN_WIDTH, "x");
    const py = check(y, SCREEN_HEIGHT, "y");
    const button =
      typeof direction === "string"
        ? SCROLL_BUTTONS[direction as ScrollDirection]
        : undefined;
    if (!button)
      throw new ComputerError("The direction is up, down, left or right.");
    const steps =
      typeof amount === "number" && Number.isInteger(amount) ? amount : NaN;
    if (!(steps >= 1 && steps <= MAX_SCROLL))
      throw new ComputerError(
        `The amount is a whole number from 1 to ${MAX_SCROLL}.`,
      );
    await this.exec(
      assistantId,
      [
        "xdotool",
        "mousemove",
        String(px),
        String(py),
        "click",
        "--repeat",
        String(steps),
        button,
      ],
      "The scroll did not work.",
    );
  }

  /** One shell command inside the computer, with a time limit and a cap on output. */
  async run(
    assistantId: string,
    command: unknown,
    seconds: unknown,
    signal?: AbortSignal,
  ): Promise<RunOutput> {
    if (typeof command !== "string" || !command.trim())
      throw new ComputerError("Give the command to run.");
    if (command.length > MAX_COMMAND_CHARS)
      throw new ComputerError("That command is too long.");
    if (command.includes("\0"))
      throw new ComputerError("That command holds a character it cannot.");
    const limit =
      seconds === undefined
        ? DEFAULT_RUN_SECONDS
        : typeof seconds === "number" && Number.isInteger(seconds)
          ? seconds
          : NaN;
    if (!(limit >= 1 && limit <= MAX_RUN_SECONDS))
      throw new ComputerError(
        `The time limit is a whole number of seconds from 1 to ${MAX_RUN_SECONDS}.`,
      );
    const result = await this.runner()(
      execArgs(assistantId, [
        "timeout",
        "--kill-after=5",
        String(limit),
        "bash",
        "-lc",
        command,
      ]),
      {
        timeoutMs: (limit + 15) * 1000,
        maxBytes: MAX_OUTPUT_CHARS * 4,
        ...(signal ? { signal } : {}),
      },
    );
    const stdout = Buffer.from(result.stdout).toString("utf8");
    return {
      code: result.code,
      stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
      stderr: result.stderr.slice(-MAX_OUTPUT_CHARS),
      timedOut: result.timedOut || result.code === 124 || result.code === 137,
      cut:
        result.overflow ||
        stdout.length > MAX_OUTPUT_CHARS ||
        result.stderr.length > MAX_OUTPUT_CHARS,
    };
  }

  /** Reads one regular file from the computer, up to the size cap. */
  async readFile(assistantId: string, raw: unknown): Promise<Uint8Array> {
    const path = insidePath(raw);
    const info = await this.runner()(
      execArgs(assistantId, ["stat", "-L", "-c", "%s|%F", "--", path]),
      { timeoutMs: 15_000 },
    );
    if (info.code !== 0)
      throw new ComputerError(
        `There is no file at ${path} on the computer. Your home folder is ${HOME}, and a path without a leading / starts there, such as exchange/notes.txt.`,
      );
    const [size, kind] = Buffer.from(info.stdout)
      .toString("utf8")
      .trim()
      .split("|");
    if (!kind?.startsWith("regular"))
      throw new ComputerError(`${path} is not a file.`);
    if (Number(size) > MAX_COPY_BYTES)
      throw new ComputerError(
        "That file is larger than 25 MB, too large to copy.",
      );
    const result = await this.runner()(
      execArgs(assistantId, [
        "head",
        "-c",
        String(MAX_COPY_BYTES + 1),
        "--",
        path,
      ]),
      { timeoutMs: 120_000, maxBytes: MAX_COPY_BYTES + 1 },
    );
    if (result.code !== 0)
      throw new ComputerError(said(result, "The file could not be read."));
    if (result.stdout.length > MAX_COPY_BYTES)
      throw new ComputerError(
        "That file is larger than 25 MB, too large to copy.",
      );
    return result.stdout;
  }

  /**
   * Saves bytes as a new file in the assistant's exchange folder. A name that
   * is taken gets a number: nothing there is ever replaced, and a link the
   * computer left there is never followed.
   */
  async saveToExchange(
    assistantId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<string> {
    const dir = this.exchangeFolder(assistantId);
    for (let n = 1; n <= 50; n += 1) {
      const candidate = withNumber(name, n);
      try {
        await writeFile(join(dir, candidate), bytes, {
          flag: "wx",
          mode: 0o600,
        });
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
          throw new ComputerError(
            "The file could not be saved in the exchange folder.",
          );
      }
    }
    throw new ComputerError(
      "The exchange folder has too many files with that name.",
    );
  }

  holdOf(assistantId: string): ComputerHold {
    return this.holds.get(assistantId)?.mode ?? "none";
  }

  /** Pauses the assistant on its computer, or gives the person control. */
  setHold(assistantId: string, mode: ComputerHold): void {
    containerName(assistantId);
    const entry = this.holds.get(assistantId) ?? {
      mode: "none" as ComputerHold,
      waiters: new Set<() => void>(),
    };
    entry.mode = mode;
    this.holds.set(assistantId, entry);
    if (mode === "none") {
      for (const wake of entry.waiters) wake();
      entry.waiters.clear();
    }
  }

  /** Waits while the person has paused the assistant or taken over. */
  whenFree(assistantId: string, signal: AbortSignal): Promise<void> {
    const entry = this.holds.get(assistantId);
    if (!entry || entry.mode === "none") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      const stop = () => {
        entry.waiters.delete(wake);
        reject(new ComputerError("Stopped."));
      };
      signal.addEventListener("abort", stop, { once: true });
      entry.waiters.add(wake);
    });
  }

  /**
   * How many times, in this run of the app, the person has turned this
   * computer off or removed it, and whether the last time was a removal. An
   * answer that began before the newest one stops using the computer instead
   * of starting it again.
   */
  endedOf(assistantId: string): ComputerEnded {
    return this.ended.get(assistantId) ?? { count: 0, removed: false };
  }

  private markEnded(assistantId: string, removed: boolean): void {
    this.ended.set(assistantId, {
      count: this.endedOf(assistantId).count + 1,
      removed,
    });
  }

  /** The person's Turn off. Counted before Docker is asked, so a step it cuts short knows why. */
  async stop(assistantId: string): Promise<void> {
    const name = containerName(assistantId);
    this.markEnded(assistantId, false);
    const result = await this.runner()(["stop", "--time", "3", name], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0 && !/No such container/i.test(result.stderr))
      throw new ComputerError(said(result, "The computer did not stop."));
  }

  /** Removes the container. The exchange folder and its files stay. */
  async remove(assistantId: string): Promise<void> {
    const name = containerName(assistantId);
    this.markEnded(assistantId, true);
    this.setHold(assistantId, "none");
    const run = this.deps.docker();
    if (!run) return;
    const result = await run(["rm", "--force", name], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0 && !/No such container/i.test(result.stderr))
      throw new ComputerError(said(result, "The computer was not removed."));
  }

  /** Stops every running computer of this app, as the app quits. */
  async stopAll(): Promise<void> {
    for (const id of this.holds.keys()) this.setHold(id, "none");
    // Docker is not asked at all when no computer was started this time.
    if (!this.touched) return;
    const run = this.deps.docker();
    if (!run) return;
    const list = await run(LIST_RUNNING_ARGS, { timeoutMs: 8000 });
    if (list.code !== 0) return;
    const ids = Buffer.from(list.stdout)
      .toString("utf8")
      .split(/\s+/)
      .filter((id) => /^[0-9a-f]{12,64}$/.test(id));
    if (ids.length === 0) return;
    await run(["stop", "--time", "3", ...ids], { timeoutMs: 20_000 });
  }
}
