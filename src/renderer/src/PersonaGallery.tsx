import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { categoryName, findPersonas, skillsOf } from "../../shared/gallery";
import { CATEGORIES, type CategoryId } from "../../shared/skill-library";
import { useSettledText } from "./a11y";
import { PERSONAS, type Persona } from "./personas";
import { SearchInput } from "./SearchInput";
import { Choices } from "./SettingsParts";
import { Icon, Pet } from "./ui";

interface PersonaGalleryProps {
  /** The persona the form was filled from, if any. */
  used: Persona | undefined;
  /** Fills the form. Nothing is saved until the person saves. */
  onUse(persona: Persona): void;
}

/**
 * The ready-made assistants: browse by category, search by name, role or
 * skill, look at the brief and the skills, then fill the form in one click.
 * The list keeps one tab stop: the arrow keys move through it, and the
 * preview follows, so Tab goes straight on to "Use this assistant".
 */
export function PersonaGallery({ used, onUse }: PersonaGalleryProps) {
  const [open, setOpen] = useState(!used);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [pickedId, setPickedId] = useState<string>("");
  const listRef = useRef<HTMLUListElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  /** Where the focus goes once the gallery folds away, so it never lands on the page. */
  const [returnTo, setReturnTo] = useState<"done" | "browse" | null>(null);
  const id = useId();

  const shown = findPersonas(
    PERSONAS.map((p) => ({
      ...p,
      name: p.assistant.name,
      skills: p.assistant.skills,
    })),
    query,
    category,
  );
  // The preview always shows one: the one picked, else the first shown.
  const picked = shown.find((p) => p.id === pickedId) ?? shown[0];
  // The one card in the tab order is the one in the preview.
  const focusId = picked?.id;

  useEffect(() => {
    if (open || !returnTo) return;
    if (returnTo === "done") doneRef.current?.focus();
    else browseRef.current?.focus();
  }, [returnTo, open]);

  const count =
    shown.length === 1
      ? "1 ready-made assistant"
      : `${shown.length} ready-made assistants`;
  const heard = useSettledText(count);

  if (PERSONAS.length === 0) return null;

  function move(event: KeyboardEvent<HTMLUListElement>) {
    const keys = [
      "ArrowDown",
      "ArrowUp",
      "ArrowRight",
      "ArrowLeft",
      "Home",
      "End",
    ];
    if (!keys.includes(event.key) || shown.length === 0) return;
    event.preventDefault();
    const at = Math.max(
      0,
      shown.findIndex((p) => p.id === focusId),
    );
    const last = shown.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? Math.min(last, at + 1)
            : Math.max(0, at - 1);
    const target = shown[next];
    if (!target) return;
    setPickedId(target.id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-persona="${target.id}"]`)
      ?.focus();
  }

  function use(persona: Persona) {
    onUse(persona);
    setReturnTo("done");
    setOpen(false);
  }

  if (!open) {
    return (
      <section className="stack-tight" aria-label="Ready-made assistants">
        <p className="dim" ref={doneRef} tabIndex={-1}>
          {used
            ? `Filled in from ${used.assistant.name}. Change anything, then save.`
            : "Start from a ready-made assistant, or fill in the form yourself."}
        </p>
        <div>
          <button
            ref={browseRef}
            type="button"
            className="link-btn"
            onClick={() => {
              setReturnTo(null);
              setOpen(true);
            }}
          >
            Browse ready-made assistants
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="stack gallery" aria-labelledby={`${id}-title`}>
      <div className="stack-tight">
        <h2 className="section-title" id={`${id}-title`}>
          Start from a ready-made assistant
        </h2>
        <details className="how">
          <summary>What using one does</summary>
          <p className="faint">
            It fills in the name, look, brief and skills below, and nothing is
            saved until you press Save. It brings no model, folder, site or
            other access: you choose those below.
          </p>
        </details>
      </div>

      <label className="field" htmlFor={`${id}-search`}>
        <span className="visually-hidden">Search by name, role or skill</span>
        <SearchInput
          id={`${id}-search`}
          className="input"
          placeholder="Search by name, role or skill"
          value={query}
          onValueChange={setQuery}
        />
      </label>

      <Choices<CategoryId | "all">
        legend="Category"
        legendHidden
        value={category}
        options={[{ id: "all" as const, name: "All" }, ...CATEGORIES]}
        onPick={setCategory}
      />

      <p className="faint" aria-hidden="true">
        {count}
      </p>
      <p className="visually-hidden" role="status">
        {heard}
      </p>

      {!picked ? (
        <div className="card pad stack-tight">
          <p>
            Nothing matches
            {query.trim() ? ` “${query.trim()}”` : ""}
            {category !== "all" ? ` in ${categoryName(category)}` : ""}.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              Show all
            </button>
          </div>
        </div>
      ) : (
        <div className="gallery-body">
          <ul
            ref={listRef}
            className="gallery-list card"
            aria-label="Ready-made assistants"
            onKeyDown={move}
          >
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="gallery-card"
                  data-persona={p.id}
                  aria-pressed={p.id === picked.id}
                  tabIndex={p.id === focusId ? 0 : -1}
                  onClick={() => setPickedId(p.id)}
                >
                  <Pet
                    pet={p.assistant.pet}
                    color={p.assistant.color}
                    size={24}
                  />
                  <span className="gallery-card-name">{p.assistant.name}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="gallery-preview card pad">
            <PersonaPreview persona={picked} onUse={() => use(picked)} />
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setReturnTo("browse");
            setOpen(false);
          }}
        >
          Fill in the form myself
        </button>
      </div>
    </section>
  );
}

function PersonaPreview({
  persona,
  onUse,
}: {
  persona: Persona;
  onUse(): void;
}) {
  const lines = persona.assistant.brief.split("\n").filter((l) => l.trim());
  const skills = skillsOf(persona.assistant.skills);
  return (
    <div className="stack">
      <div className="gallery-preview-head">
        <Pet
          pet={persona.assistant.pet}
          color={persona.assistant.color}
          size={48}
        />
        <div className="stack-tight">
          <h3 className="section-title">{persona.assistant.name}</h3>
          <span className="faint">{categoryName(persona.category)}</span>
        </div>
      </div>
      <div className="stack-tight">
        <h4 className="field-label">What it does</h4>
        <ul className="gallery-brief">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {skills.length > 0 ? (
        <div className="stack-tight">
          <h4 className="field-label">
            {skills.length === 1 ? "1 skill" : `${skills.length} skills`}
          </h4>
          <ul className="gallery-skills">
            {skills.map((s) => (
              <li key={s.id} className="badge" title={s.description}>
                {s.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <button type="button" className="btn" onClick={onUse}>
          <Icon name="check" />
          Use this assistant
        </button>
      </div>
    </div>
  );
}
