import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { DeskPetsStatus, DeskPetView } from "../../shared/desk-pets";
import {
  formatConfirmCode,
  isConfirmCode,
  normalizeCode,
} from "../../shared/pets/codes";
import {
  PET_KIND_DEFAULTS,
  PET_VOICE_IDS,
  type PetKind,
  type PetVoiceId,
} from "../../shared/pets/kinds";
import { PET_LIMITS } from "../../shared/pets/limits";
import type { AppState, SerialChoice } from "../../shared/types";
import { announce } from "./a11y";
import { api } from "./bridge";
import {
  connectProblem,
  openPetLink,
  type PetLink,
  PetUsbSession,
  serverTarget,
  webSerialAvailable,
} from "./pet-usb-driver";
import { pageTitle } from "./settings-sections";
import {
  ErrorLine,
  message as errorText,
  Icon,
  InlineConfirm,
  OkLine,
  ScreenHead,
} from "./ui";

/**
 * Settings, Desk pets: the switch, the pets and what each one does, adding one
 * over its USB cable, the voice key and the notes the pets kept. The Wi-Fi
 * password is typed into a field here and goes to the pet's cable and nowhere
 * else (pet-usb-driver.ts): it is never given to the app's main process, kept
 * or shown again. A pet can never approve anything from here; this screen has
 * no control that decides a step.
 */

/** What the system asks the first time the server listens, per platform. */
export function firewallNote(platform: string): string {
  switch (platform) {
    case "win32":
      return "Windows will ask whether OpenStellarFirm may accept connections. Tick Private networks only, and leave Public networks unticked.";
    case "darwin":
      return "macOS will ask whether OpenStellarFirm may accept incoming connections: allow it. It will also ask for Local Network access: allow that too.";
    default:
      return "If your firewall is on, open the port Desk pets use (shown here once they are on) for your home network only.";
  }
}

const VOICE_NAMES: Record<PetVoiceId, string> = {
  talia: "Talia",
  alicia: "Alicia",
  maisie: "Maisie",
  darian: "Darian",
  eldrin: "Eldrin",
  wyatt: "Wyatt",
};

const MAIN_ASSISTANT = "";

function figureName(kind: PetKind): string {
  return PET_KIND_DEFAULTS[kind].name;
}

/** The status, read again every few seconds while the screen is open. */
function usePets() {
  const [status, setStatus] = useState<DeskPetsStatus | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setStatus(await api.petsStatus());
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { status, setStatus, error, refresh };
}

/** A change made on the page: busy and error in one place, the new status kept. */
function useChange(setStatus: (status: DeskPetsStatus) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<DeskPetsStatus>) {
    setBusy(true);
    setError("");
    try {
      setStatus(await action());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function DeskPetsScreen({ state }: { state: AppState }) {
  const { status, setStatus, error, refresh } = usePets();
  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title={pageTitle("deskpets")}>
          Small figures for your desk that you talk to. They connect to this
          computer over your home Wi-Fi, and to nothing else of yours.
        </ScreenHead>
        <ErrorLine>{error}</ErrorLine>
        {status === null ? (
          error ? null : (
            <p className="faint" role="status">
              Loading…
            </p>
          )
        ) : status.enabled ? (
          <>
            {status.problem ? <ErrorLine>{status.problem}</ErrorLine> : null}
            <PetsList state={state} status={status} setStatus={setStatus} />
            <AddPet status={status} refresh={refresh} />
            <VoiceSection status={status} setStatus={setStatus} />
            <DraftsSection
              state={state}
              status={status}
              setStatus={setStatus}
            />
            <AdvancedSection status={status} setStatus={setStatus} />
          </>
        ) : (
          <TurnOn state={state} status={status} setStatus={setStatus} />
        )}
      </div>
    </div>
  );
}

function SectionBox({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="stack settings-section" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

// -- The switch ---------------------------------------------------------------

function TurnOn({
  state,
  status,
  setStatus,
}: {
  state: AppState;
  status: DeskPetsStatus;
  setStatus(next: DeskPetsStatus): void;
}) {
  const change = useChange(setStatus);
  const note = useId();
  return (
    <SectionBox title="Turn on Desk pets">
      <p className="dim">
        OpenStellarFirm starts a small server on this computer for your pets. It
        answers only devices on your own network, and a pet can talk to it only
        after you paired it. Speech goes to ElevenLabs on your own key, and
        nothing else leaves your network.
      </p>
      <p className="faint" id={note}>
        {firewallNote(state.platform)}
      </p>
      {!state.keychain ? (
        <p className="faint">
          Desk pets keep their certificate in your system's keychain, and this
          computer has none that keeps secrets private, so they cannot be turned
          on here.
        </p>
      ) : null}
      {status.problem ? <ErrorLine>{status.problem}</ErrorLine> : null}
      <ErrorLine>{change.error}</ErrorLine>
      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={change.busy || !state.keychain}
          aria-describedby={note}
          onClick={() => void change.run(() => api.petsTurnOn())}
        >
          {change.busy ? "Turning on…" : "Turn on Desk pets"}
        </button>
      </div>
    </SectionBox>
  );
}

// -- The pets -----------------------------------------------------------------

function PetsList({
  state,
  status,
  setStatus,
}: {
  state: AppState;
  status: DeskPetsStatus;
  setStatus(next: DeskPetsStatus): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const change = useChange(setStatus);
  return (
    <SectionBox title="Your desk pets">
      <p className="faint">
        {status.running
          ? `Listening on port ${status.port} for pets on your network.`
          : "The server is not running right now."}
      </p>
      <ErrorLine>{change.error}</ErrorLine>
      {status.pets.length === 0 ? (
        <p className="dim">No desk pets yet. Add one below.</p>
      ) : (
        <ul className="card list">
          {status.pets.map((pet) => (
            <li key={pet.id}>
              <div className="grow">
                <p className="row-name">
                  {pet.name}{" "}
                  <span className="faint">({figureName(pet.kind)})</span>
                </p>
                <p className="faint">{petLine(pet)}</p>
              </div>
              <span className={pet.online ? "badge badge-ok" : "badge"}>
                {pet.online ? "Online" : "Offline"}
              </span>
              <button
                type="button"
                className="btn"
                aria-expanded={open === pet.id}
                aria-label={`${open === pet.id ? "Close" : "Edit"} ${pet.name}`}
                onClick={() => setOpen(open === pet.id ? null : pet.id)}
              >
                {open === pet.id ? "Close" : "Edit"}
              </button>
              <button
                type="button"
                className="btn"
                aria-label={`Forget ${pet.name}`}
                onClick={() => setForgetting(pet.id)}
              >
                Forget
              </button>
              {forgetting === pet.id ? (
                <InlineConfirm
                  className="stack-tight list-confirm"
                  label={`Forget ${pet.name}`}
                  onClose={() => setForgetting(null)}
                >
                  <p>
                    Forget {pet.name}? It stops working with OpenStellarFirm at
                    once, and its notes are deleted. To use it again you set it
                    up again over the cable.
                  </p>
                  <div className="wrap">
                    <button
                      type="button"
                      className="btn"
                      data-autofocus
                      onClick={() => setForgetting(null)}
                    >
                      Keep {pet.name}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={change.busy}
                      onClick={() => {
                        setForgetting(null);
                        void change.run(() => api.petsForget(pet.id));
                      }}
                    >
                      Forget {pet.name}
                    </button>
                  </div>
                </InlineConfirm>
              ) : null}
              {open === pet.id ? (
                <PetEditor state={state} pet={pet} setStatus={setStatus} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionBox>
  );
}

function petLine(pet: DeskPetView): string {
  const parts = [`Firmware ${pet.firmware ?? "not known yet"}`];
  if (pet.battery !== null) {
    parts.push(
      `battery ${Math.round(pet.battery * 100)}%${pet.charging ? ", charging" : ""}`,
    );
  }
  if (pet.lastSeenAt) {
    parts.push(`last seen ${new Date(pet.lastSeenAt).toLocaleString()}`);
  }
  return parts.join(", ");
}

function PetEditor({
  state,
  pet,
  setStatus,
}: {
  state: AppState;
  pet: DeskPetView;
  setStatus(next: DeskPetsStatus): void;
}) {
  const change = useChange(setStatus);
  const [name, setName] = useState(pet.name);
  const ids = useId();
  const note = `${ids}-speak`;
  const trimmed = name.trim();
  const nameProblem =
    trimmed === ""
      ? "A pet needs a name."
      : trimmed.length > PET_LIMITS.nameMaxChars
        ? `A name is at most ${PET_LIMITS.nameMaxChars} characters.`
        : /^[\p{L}][\p{L} '’-]*$/u.test(trimmed)
          ? ""
          : "A name is letters, spaces, apostrophes and hyphens.";
  const [showName, setShowName] = useState(false);

  function save(event: FormEvent) {
    event.preventDefault();
    setShowName(true);
    if (nameProblem) return;
    void change.run(() => api.petsRename(pet.id, trimmed));
  }

  return (
    <fieldset className="plain stack list-confirm">
      <legend className="visually-hidden">Settings for {pet.name}</legend>
      <form className="wrap" onSubmit={save} noValidate>
        <label className="field grow">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            maxLength={PET_LIMITS.nameMaxChars}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showName && nameProblem ? true : undefined}
            aria-describedby={
              showName && nameProblem ? `${ids}-name` : undefined
            }
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn"
          disabled={change.busy || trimmed === pet.name}
          style={{ alignSelf: "flex-end" }}
        >
          Save name
        </button>
      </form>
      {showName && nameProblem ? (
        <ErrorLine id={`${ids}-name`}>{nameProblem}</ErrorLine>
      ) : null}
      <div className="wrap">
        <label className="field grow">
          <span className="field-label">Talks to</span>
          <select
            className="input"
            value={pet.assistantId ?? MAIN_ASSISTANT}
            disabled={change.busy}
            onChange={(event) =>
              void change.run(() =>
                api.petsSetConfig(pet.id, {
                  assistantId: event.target.value || null,
                }),
              )
            }
          >
            <option value={MAIN_ASSISTANT}>Main assistant</option>
            {state.assistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">Voice</span>
          <select
            className="input"
            value={pet.voice}
            disabled={change.busy}
            onChange={(event) =>
              void change.run(() =>
                api.petsSetConfig(pet.id, {
                  voice: event.target.value as PetVoiceId,
                }),
              )
            }
          >
            {PET_VOICE_IDS.map((id) => (
              <option key={id} value={id}>
                {VOICE_NAMES[id]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="choice">
        <input
          type="checkbox"
          checked={pet.speakAnswers}
          disabled={change.busy}
          aria-describedby={note}
          onChange={(event) =>
            void change.run(() =>
              api.petsSetConfig(pet.id, { speakAnswers: event.target.checked }),
            )
          }
        />
        <span>Speak answers</span>
      </label>
      <p className="faint" id={note}>
        The pet says the assistant's answer, without numbers, amounts or links.
        Answers can contain words from your files, so turn this off in a shared
        room: it then says only short lines such as "done".
      </p>
      <ErrorLine>{change.error}</ErrorLine>
    </fieldset>
  );
}

// -- Adding a pet -------------------------------------------------------------

type Step =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "wifi"; petKind: PetKind; firmware: string }
  | { kind: "sending"; note: string }
  | { kind: "stopped"; text: string };

function AddPet({
  status,
  refresh,
}: {
  status: DeskPetsStatus;
  refresh(): Promise<void>;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [problem, setProblem] = useState("");
  const [fieldProblem, setFieldProblem] = useState<{
    field: "ssid" | "password";
    text: string;
  } | null>(null);
  const [choice, setChoice] = useState<SerialChoice | null>(null);
  const [added, setAdded] = useState("");
  const session = useRef<PetUsbSession | null>(null);
  const ssidRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const serial = webSerialAvailable();
  const target = serverTarget(status);

  // The main process asks here which board to use when several are plugged in.
  useEffect(() => api.onSerialChoose(setChoice), []);

  // Focus goes to the first field when the Wi-Fi form appears, because the
  // person just pressed Connect to get there.
  const asking = step.kind === "wifi";
  useEffect(() => {
    if (asking) ssidRef.current?.focus();
  }, [asking]);

  // The cable is let go of when the screen goes away.
  useEffect(
    () => () => {
      void session.current?.cancel().then(() => session.current?.close());
    },
    [],
  );

  async function release() {
    const current = session.current;
    session.current = null;
    await current?.close();
  }

  async function connect() {
    setProblem("");
    setAdded("");
    setFieldProblem(null);
    if (!target.ok) {
      setProblem(target.message);
      return;
    }
    setStep({ kind: "connecting" });
    let link: PetLink;
    try {
      link = await openPetLink();
    } catch (error) {
      setChoice(null);
      setStep({ kind: "idle" });
      setProblem(connectProblem(error));
      return;
    }
    setChoice(null);
    const next = new PetUsbSession(link);
    session.current = next;
    const hello = await next.hello();
    switch (hello.outcome) {
      case "ready":
        setStep({
          kind: "wifi",
          petKind: hello.kind,
          firmware: hello.firmware,
        });
        announce(
          "Connected to a desk pet. Enter your Wi-Fi name and password.",
        );
        return;
      case "needs-update":
        await release();
        setStep({
          kind: "stopped",
          text: `This pet needs a firmware update. It has version ${hello.firmware}, which OpenStellarFirm cannot set up. Nothing was sent to it. Update its firmware from the OpenStellarFirm repository, then connect again.`,
        });
        return;
      case "already-paired":
        await release();
        setStep({
          kind: "stopped",
          text: "This pet is already set up. Hold its light for 10 seconds while it starts to set it up again, then connect again.",
        });
        return;
      case "unplugged":
        await release();
        setStep({ kind: "idle" });
        setProblem("The cable was unplugged. Plug the pet in and try again.");
        return;
      default:
        await release();
        setStep({ kind: "idle" });
        setProblem(
          "The pet did not answer. Wait a few seconds after plugging it in and try again.",
        );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const current = session.current;
    const ssid = ssidRef.current?.value ?? "";
    const password = passwordRef.current?.value ?? "";
    if (!current || !target.ok) return;
    setProblem("");
    setFieldProblem(null);
    if (ssid === "") {
      setFieldProblem({ field: "ssid", text: "Enter your Wi-Fi name." });
      ssidRef.current?.focus();
      return;
    }
    setStep({ kind: "sending", note: "Sending to the pet…" });
    // The password is given to the cable and to nothing else. It stays in the
    // field only until the try is over.
    const result = await current.pair(
      {
        ssid,
        password,
        server: target.server,
        onState: (state) =>
          setStep({
            kind: "sending",
            note:
              state === "joining"
                ? "The pet is joining your Wi-Fi…"
                : "The pet is asking OpenStellarFirm to pair…",
          }),
      },
      api,
    );
    if (result.outcome === "invalid") {
      const field = result.field === "ssid" ? "ssid" : "password";
      setFieldProblem({ field, text: result.message });
      setStep({ kind: "wifi", petKind: "astronaut", firmware: "" });
      (field === "ssid" ? ssidRef : passwordRef).current?.focus();
      return;
    }
    if (passwordRef.current) passwordRef.current.value = "";
    if (result.outcome === "confirm") {
      await release();
      setStep({ kind: "idle" });
      await refresh();
      announce("The pet is saying a code. Type it here.");
      return;
    }
    await release();
    setStep({ kind: "idle" });
    setProblem(result.message);
  }

  async function cancel() {
    const current = session.current;
    await current?.cancel();
    await release();
    if (passwordRef.current) passwordRef.current.value = "";
    setStep({ kind: "idle" });
    setProblem("");
    setFieldProblem(null);
  }

  const waiting = status.pending !== null;
  return (
    <SectionBox title="Add a desk pet">
      {step.kind === "idle" || step.kind === "stopped" ? (
        <>
          <ol className="stack-tight dim" style={{ paddingLeft: "1.25rem" }}>
            <li>Plug the pet into this computer with its USB cable.</li>
            <li>Press Connect and pick the pet if you are asked.</li>
            <li>Give it your Wi-Fi name and password.</li>
            <li>Type the code the pet says out loud.</li>
          </ol>
          <p className="faint">
            The Wi-Fi password goes over the cable to the pet and nowhere else.
            OpenStellarFirm never keeps it.
          </p>
          {!serial ? (
            <p className="faint">
              This window cannot use a USB cable, so a pet cannot be set up from
              it.
            </p>
          ) : null}
          {target.ok ? null : <p className="faint">{target.message}</p>}
          {step.kind === "stopped" ? (
            <p className="error" role="alert">
              <Icon name="alert" />
              <span>{step.text}</span>
            </p>
          ) : null}
          <ErrorLine>{problem}</ErrorLine>
          {added ? (
            <p>
              <OkLine>{added}</OkLine>
            </p>
          ) : null}
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!serial || !target.ok}
              onClick={() => void connect()}
            >
              Connect over USB
            </button>
          </div>
        </>
      ) : null}

      {step.kind === "connecting" ? (
        <div className="stack-tight">
          <p className="activity" role="status">
            <span className="pulse" aria-hidden="true" />
            Looking for a pet on the cable…
          </p>
          {choice ? (
            <BoardChooser
              choice={choice}
              onDone={(portId) => {
                void api.serialChosen(choice.requestId, portId);
                setChoice(null);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {step.kind === "wifi" ? (
        <form
          className="stack"
          onSubmit={(event) => void send(event)}
          noValidate
        >
          <p role="status">
            <OkLine>
              Connected to a pet
              {step.firmware ? ` (firmware ${step.firmware})` : ""}.
            </OkLine>
          </p>
          <label className="field">
            <span className="field-label">Wi-Fi name</span>
            <input
              ref={ssidRef}
              className="input"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              maxLength={32}
              aria-invalid={fieldProblem?.field === "ssid" ? true : undefined}
              aria-describedby={
                fieldProblem?.field === "ssid" ? `${ids}-ssid` : undefined
              }
            />
          </label>
          {fieldProblem?.field === "ssid" ? (
            <ErrorLine id={`${ids}-ssid`}>{fieldProblem.text}</ErrorLine>
          ) : null}
          <label className="field">
            <span className="field-label">Wi-Fi password</span>
            <input
              ref={passwordRef}
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              maxLength={64}
              aria-describedby={`${ids}-pw ${fieldProblem?.field === "password" ? `${ids}-pwerr` : ""}`.trim()}
              aria-invalid={
                fieldProblem?.field === "password" ? true : undefined
              }
            />
          </label>
          <p className="faint" id={`${ids}-pw`}>
            Leave it empty for a network with no password. Use a 2.4 GHz
            network. It goes over the cable to the pet and nowhere else.
          </p>
          {fieldProblem?.field === "password" ? (
            <ErrorLine id={`${ids}-pwerr`}>{fieldProblem.text}</ErrorLine>
          ) : null}
          <div className="wrap">
            <button type="submit" className="btn btn-primary">
              Send to the pet
            </button>
            <button type="button" className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {step.kind === "sending" ? (
        <div className="stack-tight">
          <p className="activity" role="status">
            <span className="pulse" aria-hidden="true" />
            {step.note}
          </p>
          <p className="faint">
            Keep the cable plugged in until the pet speaks.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {waiting && step.kind === "idle" ? (
        <ConfirmCode
          status={status}
          refresh={refresh}
          onPaired={(text) => {
            setAdded(text);
            setProblem("");
          }}
        />
      ) : null}
    </SectionBox>
  );
}

/** The USB chooser: shown only when more than one board is plugged in. */
function BoardChooser({
  choice,
  onDone,
}: {
  choice: SerialChoice;
  onDone(portId: string | null): void;
}) {
  const [picked, setPicked] = useState(choice.ports[0]?.portId ?? "");
  const name = useId();
  return (
    <InlineConfirm
      className="confirm stack"
      label="Choose a desk pet"
      onClose={() => onDone(null)}
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          onDone(picked || null);
        }}
      >
        <fieldset className="plain stack">
          <legend className="field-label">
            More than one pet is plugged in
          </legend>
          <div className="stack-tight">
            {choice.ports.map((port, index) => (
              <label key={port.portId} className="choice">
                <input
                  type="radio"
                  name={name}
                  value={port.portId}
                  data-autofocus={index === 0 ? true : undefined}
                  checked={picked === port.portId}
                  onChange={() => setPicked(port.portId)}
                />
                <span>{port.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="wrap">
          <button type="submit" className="btn btn-primary">
            Use this pet
          </button>
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </InlineConfirm>
  );
}

function ConfirmCode({
  status,
  refresh,
  onPaired,
}: {
  status: DeskPetsStatus;
  refresh(): Promise<void>;
  onPaired(text: string): void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = useId();
  const pending = status.pending;

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!isConfirmCode(code)) {
      setError("The code is 8 letters and numbers.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.petsConfirm(normalizeCode(code));
      if (result.result === "confirmed") {
        setCode("");
        onPaired("The pet is paired. It will say hello.");
        announce("The pet is paired.");
      } else if (result.result === "wrong") {
        setError(
          `That code is not right. ${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`,
        );
      } else if (result.result === "invalid") {
        setError("That is not a code. It is 8 letters and numbers.");
      } else if (result.result === "closed") {
        setError("That pairing ran out of tries or time. Start again.");
      } else {
        setError("No pet is waiting to be paired. Start again.");
      }
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => void confirm(event)}
      noValidate
    >
      <p role="status">
        {pending
          ? `A ${figureName(pending.kind)} figure is waiting. Listen to the pet and type the code it says.`
          : "Type the code the pet says."}
      </p>
      <label className="field">
        <span className="field-label">The pet's code</span>
        <input
          className="input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          maxLength={9}
          value={code}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-err` : undefined}
          onChange={(event) => setCode(formatConfirmCode(event.target.value))}
        />
      </label>
      <ErrorLine id={`${ids}-err`}>{error}</ErrorLine>
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Pair the pet"}
        </button>
      </div>
    </form>
  );
}

// -- The voice ----------------------------------------------------------------

function VoiceSection({
  status,
  setStatus,
}: {
  status: DeskPetsStatus;
  setStatus(next: DeskPetsStatus): void;
}) {
  const change = useChange(setStatus);
  const keyRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [missing, setMissing] = useState(false);
  const ids = useId();

  async function save(event: FormEvent) {
    event.preventDefault();
    const key = keyRef.current?.value.trim() ?? "";
    if (key === "") {
      setMissing(true);
      keyRef.current?.focus();
      return;
    }
    setMissing(false);
    await change.run(() => api.petsSetVoiceKey(key));
    // Write-only: the field is emptied and the key is never shown again.
    if (keyRef.current) keyRef.current.value = "";
    setSaved(true);
    announce("Saved.");
  }

  return (
    <SectionBox title="Voice">
      <p className="dim">
        Your pets listen and speak with ElevenLabs on your own key. The key is
        kept in your system's keychain and sent only to ElevenLabs. It is never
        shown again once saved.
      </p>
      {status.voiceKey ? (
        <p>
          <OkLine>An ElevenLabs key is saved.</OkLine>
        </p>
      ) : (
        <p className="faint">No key is saved, so your pets cannot speak yet.</p>
      )}
      {status.voiceProblem ? (
        <ErrorLine>{status.voiceProblem}</ErrorLine>
      ) : null}
      <form className="wrap" onSubmit={(event) => void save(event)} noValidate>
        <label className="field grow">
          <span className="field-label">
            {status.voiceKey ? "Replace the key" : "ElevenLabs key"}
          </span>
          <input
            ref={keyRef}
            className="input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            aria-invalid={missing ? true : undefined}
            aria-describedby={missing ? `${ids}-key` : undefined}
            onChange={() => setSaved(false)}
          />
        </label>
        <button
          type="submit"
          className="btn"
          style={{ alignSelf: "flex-end" }}
          disabled={change.busy}
        >
          {change.busy ? "Saving…" : "Save key"}
        </button>
        {status.voiceKey ? (
          <button
            type="button"
            className="btn"
            style={{ alignSelf: "flex-end" }}
            onClick={() => setRemoving(true)}
          >
            Remove key
          </button>
        ) : null}
      </form>
      {missing ? (
        <ErrorLine id={`${ids}-key`}>Paste your key first.</ErrorLine>
      ) : null}
      {saved && !change.error ? (
        <p>
          <OkLine>Saved.</OkLine>
        </p>
      ) : null}
      <ErrorLine>{change.error}</ErrorLine>
      {removing ? (
        <InlineConfirm
          className="confirm stack"
          label="Remove the ElevenLabs key"
          onClose={() => setRemoving(false)}
        >
          <p>
            Remove the key? Your pets cannot hear or speak until you save one
            again.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn"
              data-autofocus
              onClick={() => setRemoving(false)}
            >
              Keep the key
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={change.busy}
              onClick={() => {
                setRemoving(false);
                setSaved(false);
                void change.run(() => api.petsClearVoiceKey());
              }}
            >
              Remove the key
            </button>
          </div>
        </InlineConfirm>
      ) : null}
    </SectionBox>
  );
}

// -- Notes --------------------------------------------------------------------

function DraftsSection({
  state,
  status,
  setStatus,
}: {
  state: AppState;
  status: DeskPetsStatus;
  setStatus(next: DeskPetsStatus): void;
}) {
  const change = useChange(setStatus);
  if (status.drafts.length === 0) return null;
  return (
    <SectionBox title="Notes your pets kept">
      <p className="faint">
        Words a pet heard and kept for you to read. They are not sent to an
        assistant. Discard the ones you do not need.
      </p>
      <ErrorLine>{change.error}</ErrorLine>
      <ul className="card list">
        {status.drafts.map((draft) => {
          const pet = status.pets.find((p) => p.id === draft.petId);
          const assistant = state.assistants.find(
            (a) => a.id === draft.assistantId,
          );
          return (
            <li key={draft.id}>
              <div className="grow">
                <p>{draft.text}</p>
                <p className="faint">
                  {pet?.name ?? "A pet"}
                  {assistant ? `, for ${assistant.name}` : ""},{" "}
                  {new Date(draft.at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                className="btn"
                disabled={change.busy}
                aria-label={`Discard the note from ${pet?.name ?? "a pet"}`}
                onClick={() =>
                  void change.run(() => api.petsDiscardDraft(draft.id))
                }
              >
                Discard
              </button>
            </li>
          );
        })}
      </ul>
    </SectionBox>
  );
}

// -- Start over, turn off -----------------------------------------------------

function AdvancedSection({
  status,
  setStatus,
}: {
  status: DeskPetsStatus;
  setStatus(next: DeskPetsStatus): void;
}) {
  const change = useChange(setStatus);
  const [renewing, setRenewing] = useState(false);
  return (
    <SectionBox title="Certificate and switch">
      <p className="faint">
        Your pets trust this computer's certificate, not its name, so another
        device on your network cannot pretend to be it.
        {status.fingerprint ? (
          <>
            {" "}
            Its fingerprint is{" "}
            <span className="mono">{status.fingerprint.slice(0, 16)}…</span>
          </>
        ) : null}
      </p>
      <ErrorLine>{change.error}</ErrorLine>
      <div className="wrap">
        <button type="button" className="btn" onClick={() => setRenewing(true)}>
          Make a new certificate
        </button>
        <button
          type="button"
          className="btn"
          disabled={change.busy}
          onClick={() => void change.run(() => api.petsTurnOff())}
        >
          Turn off Desk pets
        </button>
      </div>
      {renewing ? (
        <InlineConfirm
          className="confirm stack"
          label="Make a new certificate"
          onClose={() => setRenewing(false)}
        >
          <p>
            Make a new certificate? Every pet stops trusting this computer and
            is forgotten, so each one has to be set up again over the cable.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn"
              data-autofocus
              onClick={() => setRenewing(false)}
            >
              Keep the certificate
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={change.busy}
              onClick={() => {
                setRenewing(false);
                void change.run(() => api.petsNewCertificate());
              }}
            >
              Make a new one
            </button>
          </div>
        </InlineConfirm>
      ) : null}
    </SectionBox>
  );
}
