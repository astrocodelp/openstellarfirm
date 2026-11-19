import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ComputerHold,
  type ComputerListItem,
  type ComputerReadiness,
  type ComputerSettings,
  type ComputerStatus,
  type ComputerView,
  IDLE_MINUTES,
  MAX_RUNNING,
  type MouseButton,
  normalizeKey,
  readinessOf,
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
  isAssistantId,
  LIST_ALL_ARGS,
  LIST_RUNNING_ARGS,
  LIST_RUNNING_ASSISTANTS_ARGS,
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
export const IDLE_MS = IDLE_MINUTES * 60_000;
/** Pictures kept after steps, across every assistant, in memory only. */
export const MAX_FRAMES = 120;
/** One step's picture, at most: a JPEG of the screen is far smaller. */
export const MAX_FRAME_BYTES = 2_000_000;
/** How long the answer to "can the computers be used?" is kept. */
const READY_FOR_MS = 30_000;
const NOT_READY_FOR_MS = 15_000;

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
  /** The time, in milliseconds; Date.now when not given. */
  now?(): number;
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
/**
 * The text `type` would type, checked: control characters other than new
 * lines and tabs are not typed. Exported so a card can show exactly it.
 */
export function typedText(text: unknown): string {
  if (typeof text !== "string" || !text)
    throw new ComputerError("Give the text to type.");
  if (text.length > MAX_TYPE_CHARS)
    throw new ComputerError(
      `That is too much text to type at once. Type at most ${MAX_TYPE_CHARS} characters.`,
    );
  const clean = text.replace(/[^\P{Cc}\n\t]+/gu, "");
  if (!clean) throw new ComputerError("Give the text to type.");
  return clean;
}

/** The key or combination `key` would press, checked against the list. */
export function checkedKey(raw: unknown): string {
  const key = normalizeKey(raw);
  if (!key)
    throw new ComputerError(
      "That key is not on the list. Use a name such as Enter, Tab, Escape, Backspace, Up, F5, or a combination such as ctrl+c.",
    );
  return key;
}

/** The command `run` would run and its time limit, checked. */
export function checkedCommand(
  command: unknown,
  seconds: unknown,
): { command: string; seconds: number } {
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
  return { command, seconds: limit };
}

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
  /** When each computer was last used by its assistant or the person. */
  private readonly lastUsed = new Map<string, number>();
  /** Answers and steps using each computer now; a busy one is never stopped. */
  private readonly busy = new Map<string, number>();
  /** The computers known to be on, as the page is told. */
  private readonly on = new Set<string>();
  /** Pictures after steps, oldest first. Never written to disk. */
  private readonly frames = new Map<
    string,
    { assistantId: string; bytes: Uint8Array }
  >();
  private readiness: { value: ComputerReadiness; at: number } | undefined;
  private listener: ((assistantId: string, on: boolean) => void) | undefined;

  constructor(private readonly deps: ComputerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Told each time a computer is turned on or off. */
  listen(listener: (assistantId: string, on: boolean) => void): void {
    this.listener = listener;
  }

  private setOn(assistantId: string, on: boolean): void {
    if (this.on.has(assistantId) === on) return;
    if (on) this.on.add(assistantId);
    else this.on.delete(assistantId);
    this.listener?.(assistantId, on);
  }

  /** The assistants whose computers are on, as this run knows. Asks Docker nothing. */
  runningIds(): string[] {
    return [...this.on];
  }

  private touch(assistantId: string): void {
    this.lastUsed.set(assistantId, this.now());
  }

  lastUsedOf(assistantId: string): number | undefined {
    return this.lastUsed.get(assistantId);
  }

  /**
   * Marks the computer as in use for an answer, until the returned function
   * is called. While in use it is never stopped to make room or for being idle.
   */
  lease(assistantId: string): () => void {
    this.busy.set(assistantId, (this.busy.get(assistantId) ?? 0) + 1);
    this.touch(assistantId);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.busy.get(assistantId) ?? 1) - 1;
      if (left > 0) this.busy.set(assistantId, left);
      else this.busy.delete(assistantId);
      this.touch(assistantId);
    };
  }

  private inUse(assistantId: string): boolean {
    return (
      (this.busy.get(assistantId) ?? 0) > 0 ||
      this.holdOf(assistantId) === "taken"
    );
  }

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

  async status(timeoutMs = 8000): Promise<ComputerStatus> {
    const run = this.deps.docker();
    if (!run) return { docker: "missing", image: false, building: false };
    let version: RunResult;
    try {
      version = await run(["version", "--format", "{{.Server.Version}}"], {
        timeoutMs,
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

  /**
   * Whether an answer can use its computer: Docker is here and running, and
   * the computers are set up. Kept for a short while, so an answer does not
   * wait on Docker each time. Starts nothing; with no `docker` command found,
   * no program is run at all.
   */
  async readinessNow(): Promise<ComputerReadiness> {
    const kept = this.readiness;
    if (kept) {
      const keep = kept.value === "ready" ? READY_FOR_MS : NOT_READY_FOR_MS;
      if (this.now() - kept.at < keep) return kept.value;
    }
    let value: ComputerReadiness;
    try {
      value = readinessOf(await this.status(3000));
    } catch {
      value = "missing";
    }
    this.readiness = { value, at: this.now() };
    return value;
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
      this.readiness = undefined;
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
    if (found) this.setOn(assistant.id, found.running);
    else if (this.deps.docker()) this.setOn(assistant.id, false);
    return {
      container: !found ? "none" : found.running ? "on" : "off",
      hold: this.holdOf(assistant.id),
      exchange,
    };
  }

  /** The ids of the assistants whose computers run now, from Docker. */
  private async listRunning(): Promise<string[]> {
    const result = await this.runner()(LIST_RUNNING_ASSISTANTS_ARGS, {
      timeoutMs: 8000,
    });
    if (result.code !== 0) return [];
    return Buffer.from(result.stdout)
      .toString("utf8")
      .split(/\s+/)
      .filter(isAssistantId);
  }

  /** Every computer of the app, for the list in the panel. */
  async list(assistantIds: string[]): Promise<ComputerListItem[]> {
    const states = new Map<string, "on" | "off">();
    const run = this.deps.docker();
    if (run) {
      const result = await run(LIST_ALL_ARGS, { timeoutMs: 8000 }).catch(
        () => undefined,
      );
      if (result?.code === 0)
        for (const line of Buffer.from(result.stdout)
          .toString("utf8")
          .split(/\r?\n/)) {
          const [id = "", state = ""] = line.trim().split("|");
          if (isAssistantId(id))
            states.set(id, state === "running" ? "on" : "off");
        }
    }
    return assistantIds.map((assistantId) => {
      const container = states.get(assistantId) ?? "none";
      if (run) this.setOn(assistantId, container === "on");
      const used = this.lastUsed.get(assistantId);
      return {
        assistantId,
        container,
        ...(used ? { lastUsed: new Date(used).toISOString() } : {}),
      };
    });
  }

  /**
   * Makes room before one more computer starts: with as many running as the
   * cap, the one used least recently that nothing is using now is stopped.
   * Its files stay, and the next step on it starts it again.
   */
  private async makeRoom(assistantId: string): Promise<void> {
    const others = (await this.listRunning()).filter(
      (id) => id !== assistantId,
    );
    const over = others.length - MAX_RUNNING + 1;
    if (over <= 0) return;
    const free = others
      .filter((id) => !this.inUse(id))
      .sort(
        (a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0),
      );
    if (free.length < over)
      throw new ComputerError(
        `${MAX_RUNNING} computers are working already, the most that run at once. Wait for one to finish, or turn one off in its Computer panel.`,
      );
    for (const id of free.slice(0, over)) await this.quietStop(id);
  }

  /** Stops a computer the app stopped itself, to make room or for being idle. */
  private async quietStop(assistantId: string): Promise<void> {
    const result = await this.runner()(
      ["stop", "--time", "3", containerName(assistantId)],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0 && !/No such container/i.test(result.stderr))
      throw new ComputerError(said(result, "A computer did not stop."));
    this.setOn(assistantId, false);
  }

  /**
   * Stops each computer nobody has used for the idle time. A computer that
   * an answer is using, or that the person holds, is left alone. Docker is
   * asked nothing when no computer was started in this run of the app.
   * Returns the assistants whose computers were stopped.
   */
  async sweepIdle(): Promise<string[]> {
    if (!this.touched || !this.deps.docker()) return [];
    const running = await this.listRunning();
    for (const id of this.on) if (!running.includes(id)) this.setOn(id, false);
    const stopped: string[] = [];
    const now = this.now();
    for (const id of running) {
      if (this.inUse(id)) continue;
      const used = this.lastUsed.get(id);
      // One left from before: its time starts now.
      if (used === undefined) {
        this.lastUsed.set(id, now);
        continue;
      }
      if (now - used < IDLE_MS) continue;
      await this.quietStop(id).catch(() => {});
      stopped.push(id);
    }
    return stopped;
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
    this.touch(assistant.id);
    if (!(await this.hasImage()))
      throw new ComputerError(
        "The computer is not set up yet. Press Set up computers in its Computer panel.",
      );
    const image = this.tag();
    const want = configKey(settings, image);
    const name = containerName(assistant.id);
    const found = await this.inspect(assistant.id);
    if (found && found.config !== want) {
      await run(["rm", "--force", name], { timeoutMs: 30_000 });
    }
    if (!(found && found.config === want && found.running))
      await this.makeRoom(assistant.id);
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
    this.setOn(assistant.id, true);
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
    this.touch(assistantId);
    const result = await this.runner()(execArgs(assistantId, command), {
      timeoutMs,
    });
    if (result.code !== 0 || result.timedOut)
      throw new ComputerError(said(result, fallback));
    return result;
  }

  /**
   * One picture of the screen. "png" for a model, "jpg" for the live view.
   * A look by the live view (`use` false) does not count as using it, so a
   * computer only watched still stops when idle.
   */
  async screenshot(
    assistantId: string,
    format: "png" | "jpg",
    maxBytes: number,
    use = true,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    if (use) this.touch(assistantId);
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
    const clean = typedText(text);
    await this.exec(
      assistantId,
      ["xdotool", "type", "--delay", "12", "--", clean],
      "The typing did not work.",
      60_000,
    );
  }

  async key(assistantId: string, raw: unknown): Promise<string> {
    const key = checkedKey(raw);
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
    const { command: line, seconds: limit } = checkedCommand(command, seconds);
    this.touch(assistantId);
    const result = await this.runner()(
      execArgs(assistantId, [
        "timeout",
        "--kill-after=5",
        String(limit),
        "bash",
        "-lc",
        line,
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
    this.touch(assistantId);
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

  /**
   * Keeps a picture of the screen as it is now, for the step that just ran,
   * in memory only, and returns its id. Undefined when it could not be taken.
   */
  async keepFrame(assistantId: string): Promise<string | undefined> {
    let shot: { bytes: Uint8Array };
    try {
      shot = await this.screenshot(assistantId, "jpg", MAX_FRAME_BYTES, false);
    } catch {
      return undefined;
    }
    if (shot.bytes.length === 0) return undefined;
    const id = randomUUID();
    this.frames.set(id, { assistantId, bytes: shot.bytes });
    while (this.frames.size > MAX_FRAMES) {
      const oldest = this.frames.keys().next().value;
      if (oldest === undefined) break;
      this.frames.delete(oldest);
    }
    return id;
  }

  /** A picture kept after a step, only for the assistant it belongs to. */
  frame(assistantId: string, frameId: string): Uint8Array | undefined {
    const kept = this.frames.get(frameId);
    return kept?.assistantId === assistantId ? kept.bytes : undefined;
  }

  private forgetFrames(assistantId: string): void {
    for (const [id, kept] of this.frames)
      if (kept.assistantId === assistantId) this.frames.delete(id);
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
    this.setOn(assistantId, false);
  }

  /** Removes the container. The exchange folder and its files stay. */
  async remove(assistantId: string): Promise<void> {
    const name = containerName(assistantId);
    this.markEnded(assistantId, true);
    this.setHold(assistantId, "none");
    this.forgetFrames(assistantId);
    this.lastUsed.delete(assistantId);
    const run = this.deps.docker();
    if (!run) return;
    const result = await run(["rm", "--force", name], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0 && !/No such container/i.test(result.stderr))
      throw new ComputerError(said(result, "The computer was not removed."));
    this.setOn(assistantId, false);
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
    if (ids.length > 0)
      await run(["stop", "--time", "3", ...ids], { timeoutMs: 20_000 });
    for (const id of [...this.on]) this.setOn(id, false);
  }
}
