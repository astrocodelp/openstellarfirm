import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  LocalModels,
  ModelPick,
  ModelSource,
  PresetId,
} from "../../shared/types";
import { announce } from "./a11y";
import { api } from "./bridge";
import { SourceForm } from "./Models";
import { Icon, Nova, OkLine } from "./ui";

interface WelcomeProps {
  keychain: boolean;
  onDone(source: ModelSource | null): void;
  onCloud(): void;
}

const POINTS = [
  "No account. Nothing is stored in a cloud.",
  "Your own model: a key you bring, or one that runs on this machine.",
  "It asks before it reaches a new website, and never deletes a file.",
  "The code is open: free to use, change and share, not to sell.",
];

/** The first run: pick the model the assistants think with. */
export function Welcome({ keychain, onDone, onCloud }: WelcomeProps) {
  const [local, setLocal] = useState<LocalModels | null>(null);
  // Each look has a number, so an answer to an older look is dropped.
  const looks = useRef(0);

  const look = useCallback(() => {
    const id = ++looks.current;
    setLocal(null);
    api
      .detectLocal()
      .then((found) => {
        if (looks.current === id) setLocal(found);
      })
      .catch(() => {
        if (looks.current === id) setLocal({ ollama: null, lmstudio: null });
      });
  }, []);

  useEffect(() => {
    look();
    return () => {
      looks.current++;
    };
  }, [look]);

  const found: {
    preset: PresetId;
    name: string;
    models: string[];
    pick: ModelPick | undefined;
  } | null = local?.ollama?.length
    ? {
        preset: "ollama",
        name: "Ollama",
        models: local.ollama,
        pick: local.picks?.ollama,
      }
    : local?.lmstudio?.length
      ? {
          preset: "lmstudio",
          name: "LM Studio",
          models: local.lmstudio,
          pick: local.picks?.lmstudio,
        }
      : null;
  // Running but empty: the program answers, with no model in it yet.
  const empty: "ollama" | "lmstudio" | null = found
    ? null
    : local?.ollama
      ? "ollama"
      : local?.lmstudio
        ? "lmstudio"
        : null;

  return (
    <main className="welcome" id="main" tabIndex={-1}>
      <section className="welcome-hero">
        <Nova size={96} />
        <div className="dim" style={{ fontWeight: 500 }}>
          OpenStellarFirm
        </div>
        <h1>Your own assistant, on your own computer.</h1>
        <p
          className="dim"
          style={{ maxWidth: "34em", fontSize: "var(--text-body)" }}
        >
          Give it a name, a look, a job and a model to think with.
        </p>
        <ul className="checks">
          {POINTS.map((point) => (
            <li key={point} className="check-item">
              <Icon name="check" />
              {point}
            </li>
          ))}
        </ul>
        <p className="faint">
          Need a whole team that works in the cloud?{" "}
          <button type="button" className="link" onClick={onCloud}>
            See StellarFirm
          </button>
        </p>
      </section>

      <section className="card welcome-card" aria-labelledby="welcome-title">
        <div className="stack-tight">
          <h2 className="screen-title" id="welcome-title">
            Which model should it think with?
          </h2>
          <p className="dim">
            You can change this later, and give each assistant its own.
          </p>
        </div>
        {local === null ? (
          <p className="faint" role="status">
            Looking for a model on this computer…
          </p>
        ) : found ? (
          <OkLine>
            Found {found.name} here with{" "}
            {found.models.length === 1
              ? "1 model"
              : `${found.models.length} models`}
          </OkLine>
        ) : empty ? (
          <NoModelYet program={empty} onLookAgain={look} />
        ) : (
          <NothingFound onLookAgain={look} />
        )}
        {/* The form starts again from what was found once the look is over. */}
        <SourceForm
          key={found?.preset ?? empty ?? (local ? "none" : "looking")}
          {...(found
            ? {
                initialPreset: found.preset,
                initialModels: found.models,
                ...(found.pick ? { initialPick: found.pick } : {}),
              }
            : empty
              ? { initialPreset: empty }
              : {})}
          submitLabel="Continue"
          keychain={keychain}
          onSaved={onDone}
        />
        <div>
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Skip for now
          </button>
        </div>
      </section>
    </main>
  );
}

/** Neither Ollama nor LM Studio answered on this computer. */
function NothingFound({ onLookAgain }: { onLookAgain(): void }) {
  return (
    <div className="stack-tight">
      <p className="faint">
        No model runs here yet, so get Ollama or LM Studio, or use your own key
        below.
      </p>
      <div className="wrap">
        <button
          type="button"
          className="btn"
          onClick={() => void api.openLink("ollama")}
        >
          Get Ollama
          <Icon name="external" size={14} />
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void api.openLink("lmstudio")}
        >
          Get LM Studio
          <Icon name="external" size={14} />
        </button>
        <button type="button" className="btn" onClick={onLookAgain}>
          Look again
        </button>
      </div>
    </div>
  );
}

/** Ollama or LM Studio answered, but has no model in it yet. */
function NoModelYet({
  program,
  onLookAgain,
}: {
  program: "ollama" | "lmstudio";
  onLookAgain(): void;
}) {
  return (
    <div className="stack-tight">
      {program === "ollama" ? (
        <>
          <p className="faint">
            Ollama has no model yet, so run this line in a terminal, then look
            again.
          </p>
          <CommandLine command="ollama pull qwen3" />
        </>
      ) : (
        <p className="faint">
          LM Studio has no model yet, so download one in it, such as Qwen3, then
          look again.
        </p>
      )}
      <div>
        <button type="button" className="btn" onClick={onLookAgain}>
          Look again
        </button>
      </div>
    </div>
  );
}

/**
 * A command for the person to run in their own terminal. The app never runs
 * it. Copy uses the page's own copy command on the selected text; where that
 * is refused, the text stays selected for the person to copy themselves.
 */
function CommandLine({ command }: { command: string }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState("");

  const copy = () => {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    const text = copied
      ? "Copied. Paste it in a terminal."
      : "Selected. Press Ctrl+C, or Cmd+C on a Mac, to copy it.";
    setSaid(text);
    announce(text);
  };

  return (
    <div className="stack-tight">
      <label className="visually-hidden" htmlFor={id}>
        A line to run in a terminal
      </label>
      <div className="wrap">
        <input
          ref={field}
          id={id}
          className="input mono"
          readOnly
          value={command}
          spellCheck={false}
          style={{ flex: "1 1 12rem", width: "auto", minWidth: 0 }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button type="button" className="btn" onClick={copy}>
          Copy
        </button>
      </div>
      <p className="faint">{said}</p>
    </div>
  );
}
