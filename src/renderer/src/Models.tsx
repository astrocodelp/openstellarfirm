import { type FormEvent, useId, useState } from "react";
import { BEDROCK_REGIONS } from "../../shared/address";
import { PRESET_GROUPS, PRESETS, presetOf } from "../../shared/catalog";
import type { AppState, ModelSource, PresetId } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText, OkLine, ScreenHead } from "./ui";

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
  const [part, setPart] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialModels[0] ?? "");
  const [models, setModels] = useState<string[]>(initialModels);
  const [busy, setBusy] = useState<"" | "look" | "save">("");
  const [error, setError] = useState("");
  const preset = presetOf(presetId);
  const own = preset.address === "own";
  const takesKey = !preset.local;

  function pick(next: PresetId) {
    setPresetId(next);
    setPart("");
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
        part,
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
        <span className="field-label">Where the model runs</span>
        <select
          className="input"
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
        <span className="faint">{preset.note}</span>
      </label>

      {preset.address === "azure" ? (
        <label className="field">
          <span className="field-label">Resource</span>
          <input
            className="input mono"
            value={part}
            placeholder="my-resource"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPart(event.target.value)}
          />
          <span className="faint">
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
          <span className="field-label">
            {preset.needsKey || preset.local ? "Key" : "Key, if it needs one"}
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
          <span className="faint">
            {preset.id === "azure"
              ? "Azure does not list models. Type the name you gave the deployment."
              : "This service does not list its models here. Type the model's name."}
          </span>
        )}
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
        <ScreenHead title="Your models" onBack={onBack}>
          Your assistants think only with what you set up here. Calls go from
          this computer straight to the model. StellarFirm Solo adds no fee and
          sees nothing.
        </ScreenHead>

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
                    {presetOf(source.preset).lists ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void check(source)}
                      >
                        Check
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-danger"
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
          <div className="card pad">
            <SourceForm
              submitLabel="Add"
              keychain={state.keychain}
              onSaved={() => void onChanged()}
            />
          </div>
          <p className="faint">
            Not here: Google Vertex AI, which signs in with a service account
            and not a key, and any service that does not speak the OpenAI way.
          </p>
        </section>
      </div>
    </div>
  );
}
