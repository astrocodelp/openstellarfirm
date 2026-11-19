import { useState } from "react";
import { SKILLS } from "../../shared/catalog";
import { findSkills, skillsOf } from "../../shared/gallery";
import { MAX_SKILLS, SKILL_GROUPS } from "../../shared/skill-library";
import { Icon } from "./ui";

interface SkillPickerProps {
  selected: string[];
  onToggle(id: string): void;
}

/**
 * Every skill, grouped by the kind of work and searchable. What is ticked is
 * also listed at the top, so a search never hides it.
 */
export function SkillPicker({ selected, onToggle }: SkillPickerProps) {
  const [query, setQuery] = useState("");
  const ticked = skillsOf(selected);
  const full = selected.length >= MAX_SKILLS;
  const found = findSkills(query);
  const groups = SKILL_GROUPS.map((group) => ({
    ...group,
    skills: found.filter((s) => s.group === group.id),
  })).filter((group) => group.skills.length > 0);

  return (
    <fieldset className="stack-tight plain">
      <legend className="field-label">Skills</legend>
      <p className="faint">
        Each skill adds a few lines to how it works. It is guidance, not access.
        Up to {MAX_SKILLS}.
      </p>

      {ticked.length > 0 ? (
        <ul className="gallery-skills" aria-label="Ticked skills">
          {ticked.map((skill) => (
            <li key={skill.id}>
              <button
                type="button"
                className="choice skill-chip"
                aria-label={`Remove ${skill.name}`}
                onClick={() => onToggle(skill.id)}
              >
                {skill.name}
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="field skill-search">
        <span className="visually-hidden">Search skills</span>
        <input
          className="input"
          type="search"
          placeholder="Search skills"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="skill-list card">
        {groups.length === 0 ? (
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

      <p className="faint" role="status">
        {selected.length} of {MAX_SKILLS} ticked
        {full ? ". Untick one to add another." : ""}
        {query.trim() && groups.length > 0
          ? ` · ${found.length} of ${SKILLS.length} shown`
          : ""}
      </p>
    </fieldset>
  );
}
