import { type FormEvent, useEffect, useId, useState } from "react";
import { BEDROCK_REGIONS } from "../../shared/address";
import { PRESET_GROUPS, PRESETS, presetOf } from "../../shared/catalog";
import { noKeychainNote } from "../../shared/keychain";
import type {
  AppState,
  ModelInfo,
  ModelList,
  ModelPick,
  ModelSource,
  PresetId,
} from "../../shared/types";
import { api } from "./bridge";
import { ModelPicker } from "./ModelPicker";
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
  initialModels?: ModelInfo[];
  /** The model to start with, and why: said under the field while it is chosen. */
  initialPick?: ModelPick;
  submitLabel: string;
  keychain: boolean;
  onSaved(source: ModelSource): void;
}

/** The models a service with no list to ask suggests, written in the catalog. */
function suggestionsFor(id: PresetId): ModelList | null {
  const suggested = presetOf(id).suggested;
  return suggested?.length ? { models: suggested, from: "suggested" } : null;
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
    initialPick?.model ?? initialModels[0]?.id ?? "",
  );
  const [list, setList] = useState<ModelList | null>(() =>
    initialModels.length > 0
      ? { models: initialModels, from: "listed" }
      : suggestionsFor(initialPreset),
  );
  /** True once Look for models ran here; models handed in were already told. */
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState<"" | "look" | "save">("");
  const [error, setError] = useState("");
  /** Why the last look for models failed, said under the model's box. */
  const [lookError, setLookError] = useState("");
  const preset = presetOf(presetId);
  const own = preset.address === "own";
  /** The model picked to start with, while it is still the one chosen. */
  const picked =
    initialPick && presetId === initialPreset && model === initialPick.model
      ? initialPick
      : undefined;
  const takesKey = !preset.local;
  const models = list?.models ?? [];

  function pick(next: PresetId) {
    setPresetId(next);
    setPart("");
    setList(suggestionsFor(next));
    setLooked(false);
    setModel("");
    setError("");
    setLookError("");
  }

  async function look() {
    setBusy("look");
    setError("");
    setLookError("");
    try {
      const found = await api.probeModels({
        preset: presetId,
        baseUrl,
        part,
        apiKey,
      });
      setList(found);
      setLooked(true);
      if (found.models.length === 0) {
        setLookError(
          "It answered, but listed no models. Type the model's name.",
        );
      }
    } catch (e) {
      setLookError(errorText(e));
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
              ? "Kept in this computer's keychain. It is sent only to this address, and never shown again."
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
        <ModelPicker
          id={`${ids}-model`}
          value={model}
          onChange={setModel}
          models={models}
          from={list?.from ?? null}
          looking={busy === "look"}
          error={lookError}
          {...(preset.lists ? { onLook: () => void look() } : {})}
          {...(picked ? { recommended: picked.model } : {})}
          openWhenFound
          invalid={Boolean(lookError) && models.length === 0}
          describedBy={
            [
              preset.lists && !preset.deployments ? "" : `${ids}-model-note`,
              picked ? `${ids}-pick` : "",
              lookError ? `${ids}-model-error` : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {preset.deployments ? (
          <span className="faint" id={`${ids}-model-note`}>
            These are the models your resource can use. Type your deployment's
            name if it is different.
          </span>
        ) : preset.lists ? null : (
          <span className="faint" id={`${ids}-model-note`}>
            {list?.from === "suggested" && models.length > 0
              ? "Suggestions only: this service does not list its models, so you can type any other id."
              : "This service does not list its models here. Type the model's name."}
          </span>
        )}
        {looked && models.length > 0 ? (
          <OkLine>
            Found {models.length === 1 ? "1 model" : `${models.length} models`}
          </OkLine>
        ) : null}
        {picked ? (
          <span className="faint" id={`${ids}-pick`}>
            Picked {picked.model} because {picked.reason} You can type or pick
            another.
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

/**
 * Changes a saved source's model by picking it from the source's own list,
 * asked for as soon as this opens. Only the model changes.
 */
function SourceModelEdit({
  source,
  onClose,
  onSaved,
}: {
  source: ModelSource;
  onClose(): void;
  onSaved(): Promise<void>;
}) {
  const ids = useId();
  const preset = presetOf(source.preset);
  const [model, setModel] = useState(source.model);
  const [list, setList] = useState<ModelList | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function look() {
    setLooking(true);
    setLookError("");
    try {
      const found = await api.checkSource(source.id);
      setList(found);
      if (found.models.length === 0)
        setLookError(
          "It answered, but listed no models. Type the model's name.",
        );
    } catch (e) {
      setLookError(errorText(e));
    } finally {
      setLooking(false);
    }
  }

  // The list is asked for once, when this opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on open
  useEffect(() => {
    void look();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.setSourceModel(source.id, model);
      await onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="source-edit stack"
      aria-label={`Change the model for ${source.name}`}
      onSubmit={save}
      onKeyDown={(event) => {
        // Esc with the list closed puts the row back as it was.
        if (event.key === "Escape" && !event.defaultPrevented) onClose();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor={`${ids}-model`}>
          Model
        </label>
        <ModelPicker
          id={`${ids}-model`}
          value={model}
          onChange={setModel}
          models={list?.models ?? []}
          from={list?.from ?? null}
          looking={looking}
          error={lookError}
          {...(preset.lists ? { onLook: () => void look() } : {})}
          openWhenFound
          describedBy={
            [
              list?.from === "suggested" || preset.deployments
                ? `${ids}-note`
                : "",
              lookError ? `${ids}-model-error` : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {preset.deployments ? (
          <span className="faint" id={`${ids}-note`}>
            These are the models your resource can use. Type your deployment's
            name if it is different.
          </span>
        ) : list?.from === "suggested" ? (
          <span className="faint" id={`${ids}-note`}>
            Suggestions only: this service does not list its models, so you can
            type any other id.
          </span>
        ) : null}
      </div>
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap">
        <button
          type="submit"
          className="btn"
          disabled={saving || !model.trim() || model.trim() === source.model}
        >
          {saving ? "Saving…" : "Use this model"}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
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
  /** The source whose model is being changed, under its row. */
  const [editing, setEditing] = useState<string | null>(null);

  /** Closes a model change and puts the focus back on the button that opened it. */
  function closeEdit(sourceId: string) {
    setEditing(null);
    requestAnimationFrame(() =>
      document.getElementById(`look-${sourceId}`)?.focus(),
    );
  }

  async function check(source: ModelSource) {
    setChecks((c) => ({ ...c, [source.id]: { ok: true, text: "Checking…" } }));
    try {
      const found = await api.checkSource(source.id);
      // A call to Azure names a deployment, which its list does not show:
      // that it answered with the key is the check.
      const listed =
        presetOf(source.preset).deployments ||
        found.models.some((m) => m.id === source.model);
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
          Your assistants think only with what you set up here. Calls go from
          this computer straight to the model. OpenStellarFirm adds no fee and
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
                    <button
                      type="button"
                      className="btn"
                      id={`look-${source.id}`}
                      aria-label={`Look for models for ${source.name}`}
                      aria-expanded={editing === source.id}
                      onClick={() =>
                        setEditing((open) =>
                          open === source.id ? null : source.id,
                        )
                      }
                    >
                      Look for models
                    </button>
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
                    {editing === source.id ? (
                      <SourceModelEdit
                        source={source}
                        onClose={() => closeEdit(source.id)}
                        onSaved={async () => {
                          closeEdit(source.id);
                          setChecks((c) => {
                            const { [source.id]: _, ...rest } = c;
                            return rest;
                          });
                          await onChanged();
                        }}
                      />
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
          <p className="faint">
            Not here: Google Vertex AI, which signs in with a service account
            and not a key, and any service that does not speak the OpenAI way.
          </p>
        </section>
      </div>
    </div>
  );
}
