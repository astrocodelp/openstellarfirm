import { spawn } from "node:child_process";

/**
 * Runs the `docker` program with an argument array. Never a shell, never a
 * command line built as one string: each argument reaches the program as it
 * is, whatever it holds. Tests pass a fake runner instead; nothing in a test
 * ever starts Docker.
 */

export interface RunOptions {
  /** The run is ended (and reported as timed out) after this long. */
  timeoutMs: number;
  /** Standard output kept, at most; the rest is read and dropped. */
  maxBytes?: number;
  signal?: AbortSignal;
  /** Each line of output as it arrives, for progress. */
  onLine?: (line: string) => void;
}

export interface RunResult {
  /** The exit code; null when the program was ended. */
  code: number | null;
  stdout: Uint8Array;
  /** At most the last 8,000 characters of standard error. */
  stderr: string;
  timedOut: boolean;
  /** True when standard output was longer than `maxBytes`. */
  overflow: boolean;
}

export type Runner = (
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

const DEFAULT_MAX_BYTES = 1024 * 1024;
const STDERR_KEEP = 8000;

/** A runner for the program at `file`, with `env` as its environment. */
export function spawnRunner(file: string, env: NodeJS.ProcessEnv): Runner {
  return (args, options) =>
    new Promise((resolve, reject) => {
      const max = options.maxBytes ?? DEFAULT_MAX_BYTES;
      const child = spawn(file, [...args], {
        shell: false,
        windowsHide: true,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const chunks: Buffer[] = [];
      let kept = 0;
      let overflow = false;
      let stderr = "";
      let timedOut = false;
      let pending = "";
      const lines = (text: string) => {
        if (!options.onLine) return;
        pending += text;
        const parts = pending.split(/\r?\n|\r/);
        pending = parts.pop() ?? "";
        for (const line of parts) if (line.trim()) options.onLine(line);
      };
      child.stdout.on("data", (chunk: Buffer) => {
        if (options.onLine) lines(chunk.toString("utf8"));
        if (kept >= max) {
          overflow = true;
          return;
        }
        const room = max - kept;
        if (chunk.length > room) overflow = true;
        const piece = chunk.subarray(0, room);
        chunks.push(piece);
        kept += piece.length;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        lines(text);
        stderr = (stderr + text).slice(-STDERR_KEEP);
      });
      const end = () => {
        timedOut = true;
        child.kill("SIGKILL");
      };
      const timer = setTimeout(end, options.timeoutMs);
      const aborted = () => child.kill("SIGKILL");
      options.signal?.addEventListener("abort", aborted, { once: true });
      child.on("error", (error) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", aborted);
        if (pending.trim()) options.onLine?.(pending);
        resolve({
          code,
          stdout: new Uint8Array(Buffer.concat(chunks)),
          stderr,
          timedOut,
          overflow,
        });
      });
    });
}
