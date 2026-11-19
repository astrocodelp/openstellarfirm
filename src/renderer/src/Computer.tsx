import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import {
  type ComputerHold,
  type ComputerInput,
  type ComputerSettings,
  type ComputerShot,
  type ComputerStatus,
  type ComputerView,
  CPU_CHOICES,
  defaultComputer,
  inputFromKey,
  MEMORY_CHOICES,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../../shared/computer";
import type { Assistant } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText, Icon, InlineConfirm } from "./ui";

/**
 * An assistant's own computer: a Linux desktop in Docker on this computer.
 * The choice in the assistant's form, and the panel beside the chat where the
 * person watches it, pauses it or takes over.
 */

/** About once a second while the panel is open and the window is visible. */
const SHOT_EVERY = 1000;
const VIEW_EVERY = 3000;

function useComputerStatus(enabled: boolean) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    setError("");
    try {
      setStatus(await api.computerStatus());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (enabled) void check();
  }, [enabled, check]);
  return { status, error, check };
}

/** What Docker's state means for the person, with the one next step. */
function DockerNote({
  status,
  onCheck,
}: {
  status: ComputerStatus;
  onCheck(): void;
}) {
  if (status.docker === "ready") return null;
  return (
    <div className="stack-tight">
      <p className="dim">
        {status.docker === "missing"
          ? "Docker is not on this computer. The computer runs in Docker: Docker Desktop, Docker Engine, OrbStack, Colima, or Podman with its docker command."
          : "Docker is installed, but it is not running. Start Docker, then check again."}
      </p>
      <div className="wrap">
        {status.docker === "missing" ? (
          <button
            type="button"
            className="btn"
            onClick={() => void api.openLink("docker")}
          >
            Get Docker
            <Icon name="external" size={14} />
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onCheck}>
          Check again
        </button>
      </div>
    </div>
  );
}

/** The choice in the assistant's form. Off by default. */
export function ComputerChoice({
  value,
  onChange,
}: {
  value: ComputerSettings | null;
  onChange(next: ComputerSettings | null): void;
}) {
  const on = value !== null;
  const { status, check } = useComputerStatus(on);
  const set = (patch: Partial<ComputerSettings>) =>
    onChange({ ...(value ?? defaultComputer()), ...patch });
  return (
    <div className="stack-tight">
      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(event) =>
            onChange(event.target.checked ? defaultComputer() : null)
          }
        />
        <span>A computer of its own (Docker)</span>
      </label>
      <p className="faint">
        A small Linux desktop in Docker on this computer, never in a cloud. It
        can click, type and run commands there without asking you, because it is
        kept apart from your files and apps. You can watch it, pause it or take
        over beside the chat.
      </p>
      {on && value ? (
        <div className="stack computer-options">
          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              checked={value.network}
              onChange={(event) => set({ network: event.target.checked })}
            />
            <span>Let its computer reach the internet</span>
          </label>
          <p className="faint">
            Off: nothing on its computer can reach a website or anything else.
            On: its browser and commands can reach the internet, and pages it
            reads there may try to tell it what to do. Changing this starts a
            fresh computer next time; files in its exchange folder stay.
          </p>
          <div className="wrap">
            <label className="field">
              <span className="field-label">Memory</span>
              <select
                className="input"
                value={value.memoryGb}
                onChange={(event) =>
                  set({ memoryGb: Number(event.target.value) })
                }
              >
                {MEMORY_CHOICES.map((gb) => (
                  <option key={gb} value={gb}>
                    {gb} GB
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Processors</span>
              <select
                className="input"
                value={value.cpus}
                onChange={(event) => set({ cpus: Number(event.target.value) })}
              >
                {CPU_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1 processor" : `${n} processors`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {status ? <DockerNote status={status} onCheck={check} /> : null}
          {status?.docker === "ready" ? (
            <p className="faint">
              Docker {status.version} is ready.{" "}
              {status.image
                ? "Its computer is set up."
                : "Set its computer up from the Computer panel beside the chat."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ago(at: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  return "over a minute ago";
}

const HOLD_LINE: Record<ComputerHold, (name: string) => string> = {
  none: (name) => `${name} can use it.`,
  paused: (name) => `Paused. ${name} waits until you resume.`,
  taken: (name) =>
    `You have control. Your clicks and keys go to its computer, and ${name} waits.`,
};

interface PanelProps {
  assistant: Assistant;
  /** True while the assistant is answering. */
  busy: boolean;
  onStop(): void;
  onClose(): void;
}

/** The panel beside the chat: the live view and its controls. */
export function ComputerPanel({
  assistant,
  busy,
  onStop,
  onClose,
}: PanelProps) {
  const { status, error: statusError, check } = useComputerStatus(true);
  const [view, setView] = useState<ComputerView | null>(null);
  const [shot, setShot] = useState<ComputerShot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [setupState, setSetupState] = useState<
    "idle" | "running" | "done" | "failed"
  >("idle");
  const [removing, setRemoving] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const screen = useRef<HTMLDivElement>(null);
  const takeOverButton = useRef<HTMLButtonElement>(null);
  const id = assistant.id;
  const ready = status?.docker === "ready" && status.image;
  const on = view?.container === "on";
  const taken = view?.hold === "taken";

  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  // Focus follows the control: into the view when the person takes over, and
  // back to Take over when they give it back, never left on a removed button.
  const wasTaken = useRef(false);
  useEffect(() => {
    if (taken && !wasTaken.current)
      screen.current?.focus({ preventScroll: true });
    if (!taken && wasTaken.current && document.activeElement === document.body)
      takeOverButton.current?.focus({ preventScroll: true });
    wasTaken.current = taken;
  }, [taken]);

  // Closing the panel while the person holds the computer gives it back, so
  // the assistant is never left waiting on a view nobody sees.
  const heldNow = useRef(false);
  heldNow.current = taken;
  useEffect(
    () => () => {
      if (heldNow.current) void api.computerHold(id, "none").catch(() => {});
    },
    [id],
  );

  useEffect(
    () =>
      api.onComputerProgress((p) => {
        setProgress((lines) => [...lines, p.line].slice(-30));
        if (p.state !== "running") setSetupState(p.state);
      }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset for each assistant
  useEffect(() => {
    setView(null);
    setShot(null);
    setError("");
    setRemoving(false);
  }, [id]);

  // Whether it is on, and who holds it, every few seconds: the assistant may
  // start its computer at any moment.
  useEffect(() => {
    if (!ready || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const look = async () => {
      try {
        const next = await api.computerView(id);
        if (!stopped) setView(next);
      } catch (e) {
        if (!stopped) setError(errorText(e));
      }
      if (!stopped) timer = setTimeout(look, VIEW_EVERY);
    };
    void look();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, ready, visible]);

  // The live view: a new picture about once a second, only while the panel
  // is open, the window is visible and the computer is on.
  useEffect(() => {
    if (!on || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const take = async () => {
      try {
        const next = await api.computerShot(id);
        if (!stopped && next) setShot(next);
      } catch {
        // The next one may work; the view says how old the picture is.
      }
      if (!stopped) {
        setNow(Date.now());
        timer = setTimeout(take, SHOT_EVERY);
      }
    };
    void take();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, on, visible]);

  async function act(run: () => Promise<ComputerView | undefined>) {
    setError("");
    setWorking(true);
    try {
      const next = await run();
      if (next) setView(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }

  async function setup() {
    setProgress([]);
    setSetupState("running");
    setError("");
    try {
      await api.computerSetup();
      setSetupState("done");
      await check();
    } catch (e) {
      setSetupState("failed");
      setError(errorText(e));
    }
  }

  function send(input: ComputerInput) {
    api.computerInput(id, input).catch((e: unknown) => setError(errorText(e)));
  }

  /** A point on the picture, in the computer's own pixels. */
  function point(event: MouseEvent | WheelEvent): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(
      ((event.clientX - rect.left) / rect.width) * SCREEN_WIDTH,
    );
    const y = Math.round(
      ((event.clientY - rect.top) / rect.height) * SCREEN_HEIGHT,
    );
    return {
      x: Math.min(SCREEN_WIDTH - 1, Math.max(0, x)),
      y: Math.min(SCREEN_HEIGHT - 1, Math.max(0, y)),
    };
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    screen.current?.focus({ preventScroll: true });
    send({ kind: "click", ...point(event), button: "left" });
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    send({ kind: "click", ...point(event), button: "right" });
  }

  const wheelAt = useRef(0);
  function onWheel(event: WheelEvent<HTMLDivElement>) {
    const at = Date.now();
    if (at - wheelAt.current < 120) return;
    wheelAt.current = at;
    const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
    send({
      kind: "scroll",
      ...point(event),
      direction: vertical
        ? event.deltaY > 0
          ? "down"
          : "up"
        : event.deltaX > 0
          ? "right"
          : "left",
      amount: 2,
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Tab leaves the view, so the keyboard is never trapped in it. "Press
    // Tab" below sends one to the computer.
    if (event.key === "Tab") return;
    const input = inputFromKey(event);
    if (!input) return;
    event.preventDefault();
    send(input);
  }

  const name = assistant.name;
  const picture = (text: string) =>
    shot ? (
      <img
        src={shot.src}
        alt={text}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        draggable={false}
      />
    ) : (
      <p className="faint computer-wait">
        {name}'s computer is starting. No picture yet.
      </p>
    );
  const alt = shot
    ? `The screen of ${name}'s computer, from ${ago(shot.at, now)}. ${HOLD_LINE[view?.hold ?? "none"](name)}${busy && !taken ? ` ${name} is working.` : ""}`
    : `${name}'s computer is starting. No picture yet.`;

  return (
    <aside
      className="computer-panel"
      id="computer-panel"
      aria-labelledby="computer-title"
    >
      <header className="computer-head">
        <h2 className="section-title" id="computer-title">
          {name}'s computer
        </h2>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close the computer panel"
          title="Close"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <ErrorLine>{statusError || error}</ErrorLine>

      {!status ? (
        <p className="activity" role="status">
          <span className="pulse" aria-hidden="true" />
          Looking for Docker…
        </p>
      ) : status.docker !== "ready" ? (
        <DockerNote status={status} onCheck={() => void check()} />
      ) : !status.image ? (
        <div className="stack">
          <p className="dim">
            Its computer has to be set up once on this computer. Setting it up
            downloads a Debian Linux base image and its packages (a desktop,
            Firefox, Python and common tools), about 1 GB, and builds them in
            Docker. It can take several minutes. Nothing is sent about you.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn btn-primary"
              disabled={setupState === "running" || status.building}
              onClick={() => void setup()}
            >
              {setupState === "running" || status.building
                ? "Setting up…"
                : "Set up the computer"}
            </button>
          </div>
          {progress.length > 0 ? (
            <div className="stack-tight">
              <p className="faint" role="status">
                {setupState === "running"
                  ? "Setting up. The newest step:"
                  : setupState === "done"
                    ? "Set up."
                    : "Setting up stopped."}
              </p>
              <p className="mono computer-progress">{progress.at(-1)}</p>
              <details>
                <summary className="faint">Show the last steps</summary>
                <pre className="mono computer-log">{progress.join("\n")}</pre>
              </details>
            </div>
          ) : null}
        </div>
      ) : !view ? (
        <p className="activity" role="status">
          <span className="pulse" aria-hidden="true" />
          Looking at its computer…
        </p>
      ) : !on ? (
        <div className="stack">
          <p className="dim">
            Its computer is off. It starts when {name} uses it, or now.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => void act(() => api.computerStart(id))}
            >
              {working ? "Starting…" : "Start the computer"}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {taken ? (
            // While the person holds the computer, the view takes their
            // clicks and keys, as a remote screen does.
            <div
              ref={screen}
              className="computer-screen taken"
              role="application"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: an application region takes keys, so it must take focus
              tabIndex={0}
              aria-label={alt}
              aria-describedby="computer-hint"
              onClick={onClick}
              onContextMenu={onContextMenu}
              onWheel={onWheel}
              onKeyDown={onKeyDown}
            >
              {picture("")}
            </div>
          ) : (
            <div ref={screen} className="computer-screen">
              {picture(alt)}
            </div>
          )}
          <p className="faint" id="computer-hint" role="status">
            {HOLD_LINE[view.hold](name)}
            {taken
              ? " Tab moves out of the view; Cmd stands for Ctrl."
              : busy
                ? ` ${name} is working.`
                : ""}
          </p>
          <div className="wrap">
            {view.hold === "none" ? (
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => void act(() => api.computerHold(id, "paused"))}
              >
                Pause
              </button>
            ) : view.hold === "paused" ? (
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => void act(() => api.computerHold(id, "none"))}
              >
                Resume
              </button>
            ) : null}
            {taken ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={working}
                  onClick={() => void act(() => api.computerHold(id, "none"))}
                >
                  Give back
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => send({ kind: "key", key: "Tab" })}
                >
                  Press Tab
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={working}
                ref={takeOverButton}
                onClick={() => void act(() => api.computerHold(id, "taken"))}
              >
                Take over
              </button>
            )}
            {busy ? (
              <button type="button" className="btn" onClick={onStop}>
                <Icon name="stop" size={14} />
                Stop the answer
              </button>
            ) : null}
          </div>
        </div>
      )}

      {ready && view ? (
        <div className="stack-tight computer-foot">
          <p className="faint">
            Files go in and out through its exchange folder:{" "}
            <span className="mono">{view.exchange}</span>
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn"
              onClick={() =>
                void act(async () => {
                  await api.computerOpenExchange(id);
                  return undefined;
                })
              }
            >
              <Icon name="folder" size={14} />
              Open the exchange folder
            </button>
            {on ? (
              <button
                type="button"
                className="btn"
                disabled={working}
                onClick={() => void act(() => api.computerStop(id))}
              >
                Turn off
              </button>
            ) : null}
            {view.container !== "none" && !removing ? (
              <button
                type="button"
                className="btn"
                onClick={() => setRemoving(true)}
              >
                Remove the computer
              </button>
            ) : null}
          </div>
          {removing ? (
            <InlineConfirm
              className="confirm stack"
              label="Remove the computer"
              onClose={() => setRemoving(false)}
            >
              <p>
                Remove {name}'s computer and everything on it? Files in its
                exchange folder stay. A fresh one starts the next time it is
                used.
              </p>
              <div className="wrap">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    void act(async () => {
                      const next = await api.computerRemove(id);
                      setRemoving(false);
                      setShot(null);
                      return next;
                    })
                  }
                >
                  Remove
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRemoving(false)}
                >
                  Keep it
                </button>
              </div>
            </InlineConfirm>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
