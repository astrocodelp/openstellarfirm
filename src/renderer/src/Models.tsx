import { type FormEvent, useId, useState } from "react";
import { PRESETS, presetOf } from "../../shared/catalog";
import type { AppState, ModelSource, PresetId } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText, OkLine } from "./ui";

interface SourceFormProps {
  initialPreset?: PresetId;
  initialModels?: string[];
  submitLabel: string;
  keychain: boolean;
  onSaved(source: ModelSource): void;
}

/** Adds a place a model runs: this computer, a key, or an address. */
export function SourceForm({
  initialPreset = "ollama",
  initialModels = [],
  submitLabel,
  keychain,
  onSaved,
}: SourceFormProps) {
  const ids = useId();
  const [presetId, setPresetId] = useState<PresetId>(initialPreset);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialModels[0] ?? "");
  const [models, setModels] = useState<string[]>(initialModels);
  const [busy, setBusy] = useState<"" | "look" | "save">("");
  const [error, setError] = useState("");
  const preset = presetOf(presetId);
  const custom = preset.id === "custom";
  const takesKey = !preset.local;

  function pick(next: PresetId) {
    setPresetId(next);
    setModels([]);
    setModel("");
    setError("");
  }

  async function look() {
    setBusy("look");
    setError("");
    try {
      const found = await api.probeModels({
        preset: presetId,
        baseUrl,
        apiKey,
      });
      setModels(found);
      if (found.length === 0)
        setError("It answered, but listed no models. Type the model's name.");
      else if (!found.includes(model)) setModel(found[0] ?? "");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      onSaved(
        await api.saveSource({ preset: presetId, baseUrl, apiKey, model }),
      );
      setApiKey("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span className="field-label">Where the model runs</span>
        <select
          className="input"
          value={presetId}
          onChange={(event) => pick(event.target.value as PresetId)}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="faint">{preset.note}</span>
      </label>

      {custom ? (
        <label className="field">
          <span className="field-label">Address</span>
          <input
            className="input mono"
            value={baseUrl}
            placeholder="https://models.example.com/v1"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
      ) : null}

      {takesKey ? (
        <label className="field">
          <span className="field-label">
            {custom ? "Key, if it needs one" : "Key"}
          </span>
          <input
            className="input mono"
            type="password"
            value={apiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className="faint">
            {keychain
              ? "Kept in this computer's keychain. It is sent only to this address, and never shown again."
              : "This computer has no keychain, so a key cannot be saved here."}
          </span>
        </label>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-model`}>
          Model
        </label>
        <div className="wrap">
          <input
            id={`${ids}-model`}
            className="input mono grow"
            value={model}
            list={`${ids}-models`}
            placeholder="The model's name, as its maker writes it"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id={`${ids}-models`}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn"
            disabled={busy !== ""}
            onClick={() => void look()}
          >
            {busy === "look" ? "Looking…" : "Look for models"}
          </button>
        </div>
        {models.length > 0 ? (
          <OkLine>
            Found {models.length === 1 ? "1 model" : `${models.length} models`}
          </OkLine>
        ) : null}
      </div>

      <ErrorLine>{error}</ErrorLine>
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy !== "" || !model.trim()}
        >
          {busy === "save" ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

interface ModelsScreenProps {
  state: AppState;
  onChanged(): Promise<void>;
  onBack(): void;
}

export function ModelsScreen({ state, onChanged, onBack }: ModelsScreenProps) {
  const [checks, setChecks] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [error, setError] = useState("");

  async function check(source: ModelSource) {
    setChecks((c) => ({ ...c, [source.id]: { ok: true, text: "Checking…" } }));
    try {
      const found = await api.checkSource(source.id);
      const listed = found.includes(source.model);
      setChecks((c) => ({
        ...c,
        [source.id]: listed
          ? { ok: true, text: "Working" }
          : {
              ok: false,
              text: `It answered, but does not list "${source.model}".`,
            },
      }));
    } catch (e) {
      setChecks((c) => ({
        ...c,
        [source.id]: { ok: false, text: errorText(e) },
      }));
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="screen">
      <div className="screen-body">
        <div className="stack-tight">
          <div>
            <button type="button" className="btn" onClick={onBack}>
              Back to chats
            </button>
          </div>
          <h1 className="screen-title">Your models</h1>
          <p className="dim">
            Your assistants think only with what you set up here. Calls go from
            this computer straight to the model. StellarFirm Open adds no fee
            and sees nothing.
          </p>
        </div>

        <section className="stack" aria-labelledby="sources-title">
          <h2 className="section-title" id="sources-title">
            Set up
          </h2>
          {state.sources.length === 0 ? (
            <p className="dim">Nothing yet. Add a model below.</p>
          ) : (
            <ul className="list card">
              {state.sources.map((source) => {
                const result = checks[source.id];
                const isDefault = state.settings.defaultSourceId === source.id;
                return (
                  <li key={source.id}>
                    <span className="grow stack-tight">
                      <span className="row-name">{source.name}</span>
                      <span className="faint mono">
                        {source.model} · {host(source.baseUrl)}
                      </span>
                      <span className="faint">
                        {source.hasKey
                          ? "Key saved in the keychain"
                          : "No key saved"}
                      </span>
                      {result ? (
                        result.ok ? (
                          <OkLine>{result.text}</OkLine>
                        ) : (
                          <ErrorLine>{result.text}</ErrorLine>
                        )
                      ) : null}
                    </span>
                    {isDefault ? (
                      <span className="badge">Default</span>
                    ) : (
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void run(() =>
                            api.setSettings({ defaultSourceId: source.id }),
                          )
                        }
                      >
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void check(source)}
                    >
                      Check
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void run(() => api.removeSource(source.id))
                      }
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <ErrorLine>{error}</ErrorLine>
        </section>

        <section className="stack" aria-labelledby="add-title">
          <h2 className="section-title" id="add-title">
            Add a model
          </h2>
          <div className="card" style={{ padding: "1rem" }}>
            <SourceForm
              submitLabel="Add"
              keychain={state.keychain}
              onSaved={() => void onChanged()}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
