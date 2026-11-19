import { useEffect, useId, useRef, useState } from "react";
import { SKILLS } from "../../shared/catalog";
import { findSkills, skillsOf } from "../../shared/gallery";
import { type OwnSkill, ownAsSkill } from "../../shared/own-skills";
import { MAX_SKILLS, SKILL_GROUPS } from "../../shared/skill-library";
import { OwnSkillRow } from "./OwnSkills";
import { SearchInput } from "./SearchInput";
import { Icon } from "./ui";

interface SkillPickerProps {
  selected: string[];
  onToggle(id: string): void;
  /** The person's own skills, listed first as "My skills". */
  own?: OwnSkill[];
  /** One of them was edited or deleted. */
  onOwnChanged?(): void;
}

/**
 * Every skill, grouped by the kind of work and searchable. What is ticked is
 * also listed at the top, so a search never hides it.
 */
export function SkillPicker({
  selected,
  onToggle,
  own = [],
  onOwnChanged,
}: SkillPickerProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const chipsRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Where a removed chip stood, so the focus goes to its neighbour, not the page. */
  const refocus = useRef<number | null>(null);
  const ownSkills = own.map(ownAsSkill);
  const ticked = [
    ...ownSkills.filter((s) => selected.includes(s.id)),
    ...skillsOf(selected),
  ];
  const full = selected.length >= MAX_SKILLS;
  const found = findSkills(query);
  const foundOwn = new Set(findSkills(query, ownSkills).map((s) => s.id));
  const mine = own.filter((s) => foundOwn.has(s.id));
  const groups = SKILL_GROUPS.map((group) => ({
    ...group,
    skills: found.filter((s) => s.group === group.id),
  })).filter((group) => group.skills.length > 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: after a chip goes
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const chips = chipsRef.current?.querySelectorAll("button") ?? [];
    const next = chips[Math.min(at, chips.length - 1)];
    (next ?? searchRef.current)?.focus({ preventScroll: true });
  }, [selected]);

  return (
    <fieldset className="stack-tight plain">
      <legend className="field-label">Skills</legend>
      <p className="faint">
        Each skill adds a few lines to how it works. It is guidance, not access.
        Up to {MAX_SKILLS}.
      </p>

      {ticked.length > 0 ? (
        <ul
          ref={chipsRef}
          className="gallery-skills"
          aria-label="Ticked skills"
        >
          {ticked.map((skill, index) => (
            <li key={skill.id}>
              <button
                type="button"
                className="choice skill-chip"
                aria-label={`Remove ${skill.name}`}
                onClick={() => {
                  refocus.current = index;
                  onToggle(skill.id);
                }}
              >
                {skill.name}
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="field skill-search" htmlFor={searchId}>
        <span className="visually-hidden">Search skills</span>
        <SearchInput
          ref={searchRef}
          id={searchId}
          className="input"
          placeholder="Search skills"
          value={query}
          onValueChange={setQuery}
        />
      </label>

      <div className="skill-list card">
        {mine.length > 0 ? (
          <fieldset className="skill-group">
            <legend className="skill-group-title">My skills</legend>
            <ul className="skill-options">
              {mine.map((skill) => {
                const on = selected.includes(skill.id);
                return (
                  <OwnSkillRow
                    key={skill.id}
                    skill={skill}
                    checked={on}
                    disabled={!on && full}
                    onToggle={() => onToggle(skill.id)}
                    onChanged={() => onOwnChanged?.()}
                  />
                );
              })}
            </ul>
          </fieldset>
        ) : null}
        {groups.length === 0 && mine.length === 0 ? (
          <p className="faint pad">
            No skill matches “{query.trim()}”.{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => setQuery("")}
            >
              Show all
            </button>
          </p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.id} className="skill-group">
              <legend className="skill-group-title">{group.name}</legend>
              <ul className="skill-options">
                {group.skills.map((skill) => {
                  const on = selected.includes(skill.id);
                  return (
                    <li key={skill.id}>
                      <label className="skill-option">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && full}
                          onChange={() => onToggle(skill.id)}
                        />
                        <span className="stack-tight skill-option-text">
                          <span>{skill.name}</span>
                          <span className="faint">{skill.description}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))
        )}
      </div>

      <p className="faint">
        {/* Only the ticks are told; the search count would be read on every key. */}
        <span role="status">
          {selected.length} of {MAX_SKILLS} ticked
          {full ? ". Untick one to add another." : ""}
        </span>
        {query.trim() && groups.length + mine.length > 0 ? (
          <span>{` · ${found.length + mine.length} of ${SKILLS.length + own.length} shown`}</span>
        ) : null}
      </p>
    </fieldset>
  );
}
