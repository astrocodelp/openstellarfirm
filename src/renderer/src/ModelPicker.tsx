import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { ModelInfo, ModelList } from "../../shared/types";
import {
  filterModels,
  MAX_SHOWN,
  modelFacts,
  orderModels,
  type PickerState,
  pickerKey,
} from "./model-picker";
import { ErrorLine, Icon } from "./ui";

/**
 * The one way a model is chosen: a box to type in, with the models the
 * service listed under it. Typing filters them; arrows and Enter choose one;
 * a name that is not in the list is kept as typed. Enter never submits the
 * form around it.
 */

interface ModelPickerProps {
  /** The box's id, for the label that names it. */
  id: string;
  value: string;
  onChange(value: string): void;
  models: ModelInfo[];
  /** Where the list came from; null before anything was looked for. */
  from: ModelList["from"] | null;
  /** True while the list is being fetched. */
  looking: boolean;
  /** Why the last look failed, if it did. */
  error?: string;
  /** Asks for the list again. Without it there is no Look button. */
  onLook?(): void;
  /** A model to put first and mark, such as the one picked to start with. */
  recommended?: string;
  placeholder?: string;
  /** Other lines that describe the box, by id. */
  describedBy?: string;
  invalid?: boolean;
  /** Moves the focus into the box and opens the list once a look finds models. */
  openWhenFound?: boolean;
}

export function ModelPicker({
  id,
  value,
  onChange,
  models,
  from,
  looking,
  error,
  onLook,
  recommended,
  placeholder = "The model's name, as its maker writes it",
  describedBy,
  invalid,
  openWhenFound = false,
}: ModelPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PickerState>({ open: false, active: -1 });
  /** True once the person typed since the list last opened: the words filter. */
  const [filtering, setFiltering] = useState(false);

  const ordered = orderModels(models, recommended);
  const matches = filtering ? filterModels(ordered, value) : ordered;
  const shown = matches.slice(0, MAX_SHOWN);
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const open = state.open && models.length > 0;
  const looked = from !== null;

  // When a look finds models, the list opens on them, so a pick is one step.
  const lookedOnce = useRef(looking);
  useEffect(() => {
    const finished = lookedOnce.current && !looking;
    lookedOnce.current = looking;
    if (!finished || !openWhenFound || models.length === 0 || error) return;
    input.current?.focus();
    setFiltering(false);
    const at = orderModels(models, recommended).findIndex(
      (m) => m.id === value,
    );
    setState({ open: true, active: Math.max(at, 0) });
  }, [looking, models, error, openWhenFound, recommended, value]);

  // The highlighted row is always in view, inside the list only.
  useEffect(() => {
    if (!open || state.active < 0) return;
    const row = list.current?.querySelector<HTMLElement>(
      `#${CSS.escape(optionId(state.active))}`,
    );
    row?.scrollIntoView({ block: "nearest" });
  });

  function openList() {
    if (models.length === 0) return;
    setFiltering(false);
    const at = ordered.findIndex((m) => m.id === value);
    setState({ open: true, active: at });
  }

  function choose(model: ModelInfo | undefined) {
    if (!model) return;
    onChange(model.id);
    setFiltering(false);
    setState({ open: false, active: -1 });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // A closed list opens on the model already chosen.
    const active = open ? state.active : shown.findIndex((m) => m.id === value);
    const result = pickerKey(
      { open, active },
      {
        key: event.key,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
      },
      shown.length,
    );
    if (result.prevent) event.preventDefault();
    if (result.stop) event.stopPropagation();
    if (result.choose !== undefined) choose(shown[result.choose]);
    else setState(result.state);
  }

  const status = looking
    ? "Looking for models…"
    : open
      ? matches.length === 0
        ? "No model matches."
        : `${matches.length === 1 ? "1 model" : `${matches.length} models`} to pick from.`
      : "";

  return (
    <div className="model-picker stack-tight">
      <div className="wrap model-picker-row">
        <div className="model-picker-box grow">
          <input
            ref={input}
            id={id}
            className="input mono model-picker-input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && state.active >= 0 && state.active < shown.length
                ? optionId(state.active)
                : undefined
            }
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            onChange={(event) => {
              onChange(event.target.value);
              setFiltering(true);
              setState({
                open: models.length > 0,
                active: event.target.value.trim() ? 0 : -1,
              });
            }}
            onClick={() => (open ? null : openList())}
            onKeyDown={onKeyDown}
            onBlur={() => setState((s) => ({ ...s, open: false }))}
          />
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Models"
            className="model-picker-list"
            hidden={!open}
            // A press on the list's scrollbar must not take the focus away.
            onMouseDown={(event) => event.preventDefault()}
          >
            {shown.map((model, index) => (
              <ModelOption
                key={model.id}
                id={optionId(index)}
                model={model}
                active={index === state.active}
                chosen={model.id === value}
                recommended={model.id === recommended}
                onPoint={() => {
                  if (index !== state.active)
                    setState((s) => ({ ...s, active: index }));
                }}
                onPick={() => choose(model)}
              />
            ))}
            {open && matches.length === 0 ? (
              <p className="model-picker-empty faint">
                No model matches. Enter keeps what you typed.
              </p>
            ) : null}
            {open && matches.length > shown.length ? (
              <p className="model-picker-empty faint">
                Showing {shown.length} of {matches.length}. Type to narrow it.
              </p>
            ) : null}
          </div>
        </div>
        {onLook ? (
          <button
            type="button"
            className="btn"
            disabled={looking}
            onClick={onLook}
          >
            {looking ? "Looking…" : looked ? "Look again" : "Look for models"}
          </button>
        ) : null}
      </div>
      <p className="visually-hidden" role="status">
        {status}
      </p>
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </div>
  );
}

function ModelOption({
  id,
  model,
  active,
  chosen,
  recommended,
  onPoint,
  onPick,
}: {
  id: string;
  model: ModelInfo;
  active: boolean;
  chosen: boolean;
  recommended: boolean;
  onPoint(): void;
  onPick(): void;
}) {
  const facts = modelFacts(model);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the box's arrows and Enter choose an option
    // biome-ignore lint/a11y/useFocusableInteractive: the box keeps the focus; aria-activedescendant points here
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-chosen={chosen || undefined}
      className="model-option"
      // The box keeps the focus, so the list stays open until the click lands.
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={onPoint}
      onClick={onPick}
    >
      <span className="model-option-mark">
        {chosen ? <Icon name="check" size={14} /> : null}
      </span>
      <span className="model-option-id mono">{model.id}</span>
      {model.name ? (
        <span className="model-option-name">{model.name}</span>
      ) : null}
      {recommended ? (
        <span className="model-option-tag">Recommended</span>
      ) : null}
      {facts ? <span className="model-option-facts">{facts}</span> : null}
    </div>
  );
}
