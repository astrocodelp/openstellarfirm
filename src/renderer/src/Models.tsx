import { type FormEvent, useId, useState } from "react";
import { BEDROCK_REGIONS } from "../../shared/address";
import { PRESET_GROUPS, PRESETS, presetOf } from "../../shared/catalog";
import { noKeychainNote } from "../../shared/keychain";
import type {
  AppState,
  ModelPick,
  ModelSource,
  PresetId,
} from "../../shared/types";
import { api } from "./bridge";
import { pageTitle } from "./settings-sections";
import {
  ErrorLine,
  message as errorText,
  InlineConfirm,
  OkLine,
  ScreenHead,
} from "./ui";

interface SourceFormProps {
  initialPreset?: PresetId;
  initialModels?: string[];
  /** The model to start with, and why: said under the field while it is chosen. */
  initialPick?: ModelPick;
  submitLabel: string;
  keychain: boolean;
  onSaved(source: ModelSource): void;
}

/** Adds a place a model runs: this computer, a key, or an address. */
export function SourceForm({
  initialPreset = "ollama",
  initialModels = [],
  initialPick,
  submitLabel,
  keychain,
  onSaved,
}: SourceFormProps) {
  const ids = useId();
  const [presetId, setPresetId] = useState<PresetId>(initialPreset);
  const [baseUrl, setBaseUrl] = useState("");
  const [part, setPart] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(
    initialPick?.model ?? initialModels[0] ?? "",
  );
  const [models, setModels] = useState<string[]>(initialModels);
  /** True once Look for models ran here; models handed in were already told. */
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState<"" | "look" | "save">("");
  const [error, setError] = useState("");
  /** True when the error is about the model's name, so it is tied to that field. */
  const [modelError, setModelError] = useState(false);
  const preset = presetOf(presetId);
  const own = preset.address === "own";
  /** The model picked to start with, while it is still the one chosen. */
  const picked =
    initialPick && presetId === initialPreset && model === initialPick.model
      ? initialPick
      : undefined;
  const takesKey = !preset.local;

  function pick(next: PresetId) {
    setPresetId(next);
    setPart("");
    setModels([]);
    setLooked(false);
    setModel("");
    setError("");
    setModelError(false);
  }

  async function look() {
    setBusy("look");
    setError("");
    setModelError(false);
    try {
      const found = await api.probeModels({
        preset: presetId,
        baseUrl,
        part,
        apiKey,
      });
      setModels(found);
      setLooked(true);
      if (found.length === 0) {
        setError("It answered, but listed no models. Type the model's name.");
        setModelError(true);
      } else if (!found.includes(model)) setModel(found[0] ?? "");
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
    setModelError(false);
    try {
      onSaved(
        await api.saveSource({
          preset: presetId,
          baseUrl,
          part,
          apiKey,
          model,
        }),
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
        <span className="field-label" id={`${ids}-where`}>
          Where the model runs
        </span>
        <select
          className="input"
          aria-labelledby={`${ids}-where`}
          aria-describedby={`${ids}-where-note`}
          value={presetId}
          onChange={(event) => pick(event.target.value as PresetId)}
        >
          {PRESET_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.name}>
              {PRESETS.filter((p) => p.group === group.id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="faint" id={`${ids}-where-note`}>
          {preset.note}
        </span>
      </label>

      {preset.address === "azure" ? (
        <label className="field">
          <span className="field-label" id={`${ids}-resource`}>
            Resource
          </span>
          <input
            aria-labelledby={`${ids}-resource`}
            aria-describedby={`${ids}-resource-note`}
            className="input mono"
            value={part}
            placeholder="my-resource"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPart(event.target.value)}
          />
          <span className="faint" id={`${ids}-resource-note`}>
            The resource's name, or its address ending in openai.azure.com.
          </span>
        </label>
      ) : null}

      {preset.address === "bedrock" ? (
        <label className="field">
          <span className="field-label">Region</span>
          <select
            className="input"
            value={part}
            onChange={(event) => setPart(event.target.value)}
          >
            <option value="">Pick a region</option>
            {BEDROCK_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {own ? (
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
          <span className="field-label" id={`${ids}-key`}>
            {preset.needsKey || preset.local ? "Key" : "Key, if it needs one"}
          </span>
          <input
            aria-labelledby={`${ids}-key`}
            aria-describedby={`${ids}-key-note`}
            className="input mono"
            type="password"
            value={apiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
          />
          <span className="faint" id={`${ids}-key-note`}>
            {keychain
              ? "Kept in this computer's keychain, sent only to this address and never shown again."
              : noKeychainNote(
                  document.documentElement.dataset.platform,
                  "key",
                )}
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
            aria-invalid={modelError || undefined}
            aria-describedby={
              [
                preset.lists ? "" : `${ids}-model-note`,
                picked ? `${ids}-pick` : "",
                modelError ? `${ids}-error` : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
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
          {preset.lists ? (
            <button
              type="button"
              className="btn"
              disabled={busy !== ""}
              onClick={() => void look()}
            >
              {busy === "look" ? "Looking…" : "Look for models"}
            </button>
          ) : null}
        </div>
        {preset.lists ? null : (
          <span className="faint" id={`${ids}-model-note`}>
            {preset.id === "azure"
              ? "Type the name you gave the deployment, since Azure lists no models."
              : "Type the model's name, since this service does not list them here."}
          </span>
        )}
        {looked && models.length > 0 ? (
          <OkLine>
            Found {models.length === 1 ? "1 model" : `${models.length} models`}
          </OkLine>
        ) : null}
        {picked ? (
          <span className="faint" id={`${ids}-pick`}>
            Picked {picked.model} because {picked.reason}
          </span>
        ) : null}
      </div>

      <ErrorLine id={`${ids}-error`}>{error}</ErrorLine>
      <div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy !== "" || !model.trim()}
          aria-describedby={error ? `${ids}-error` : undefined}
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
}

export function ModelsScreen({ state, onChanged }: ModelsScreenProps) {
  const [checks, setChecks] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

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
        <ScreenHead title={pageTitle("models")}>
          Calls go straight from this computer to the model, with no fee added.
        </ScreenHead>

        <section className="stack" aria-labelledby="sources-title">
          <h2 className="section-title" id="sources-title">
            Set up
          </h2>
          {state.sources.length === 0 ? (
            <p className="dim">No models yet.</p>
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
                        result.text === "Checking…" ? (
                          // Not a tick: nothing has worked yet.
                          <span className="faint" role="status">
                            {result.text}
                          </span>
                        ) : result.ok ? (
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
                        aria-label={`Make ${source.name} the default`}
                        onClick={() =>
                          void run(() =>
                            api.setSettings({ defaultSourceId: source.id }),
                          )
                        }
                      >
                        Make default
                      </button>
                    )}
                    {presetOf(source.preset).lists ? (
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Check ${source.name}`}
                        onClick={() => void check(source)}
                      >
                        Check
                      </button>
                    ) : null}
                    {removing === source.id ? (
                      <InlineConfirm
                        className="confirm stack list-confirm"
                        label={`Remove ${source.name}`}
                        onClose={() => setRemoving(null)}
                      >
                        <p>
                          Remove {source.name}? Its saved key is deleted.
                          Assistants that used it go back to the default.
                        </p>
                        <div className="wrap">
                          <button
                            data-autofocus
                            type="button"
                            className="btn"
                            onClick={() => setRemoving(null)}
                          >
                            Keep it
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() =>
                              void run(async () => {
                                await api.removeSource(source.id);
                                setRemoving(null);
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </InlineConfirm>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger"
                        aria-label={`Remove ${source.name}`}
                        onClick={() => setRemoving(source.id)}
                      >
                        Remove
                      </button>
                    )}
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
          <div className="card pad">
            <SourceForm
              submitLabel="Add"
              keychain={state.keychain}
              onSaved={() => void onChanged()}
            />
          </div>
          <details className="how">
            <summary>How models work</summary>
            <p className="faint">
              Your assistants think only with what you set up here. Calls go
              from this computer straight to the model. OpenStellarFirm adds no
              fee and sees nothing. Not here: Google Vertex AI, which signs in
              with a service account and not a key, and any service that does
              not speak the OpenAI way.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
