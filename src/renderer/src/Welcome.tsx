import { useEffect, useState } from "react";
import type { LocalModels, ModelSource, PresetId } from "../../shared/types";
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
  "The code is open: free to use, change and share.",
];

/** The first run: pick the model the assistants think with. */
export function Welcome({ keychain, onDone, onCloud }: WelcomeProps) {
  const [local, setLocal] = useState<LocalModels | null>(null);

  useEffect(() => {
    let live = true;
    api
      .detectLocal()
      .then((found) => {
        if (live) setLocal(found);
      })
      .catch(() => {
        if (live) setLocal({ ollama: null, lmstudio: null });
      });
    return () => {
      live = false;
    };
  }, []);

  const found: { preset: PresetId; name: string; models: string[] } | null =
    local?.ollama?.length
      ? { preset: "ollama", name: "Ollama", models: local.ollama }
      : local?.lmstudio?.length
        ? { preset: "lmstudio", name: "LM Studio", models: local.lmstudio }
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
          Give it a name, a look and a job. It thinks with a model you choose.
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
        ) : (
          <p className="faint">
            No model is running on this computer. Start Ollama or LM Studio, or
            use your own key.
          </p>
        )}
        {/* The form starts again from what was found once the look is over. */}
        <SourceForm
          key={found?.preset ?? (local ? "none" : "looking")}
          {...(found
            ? { initialPreset: found.preset, initialModels: found.models }
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
