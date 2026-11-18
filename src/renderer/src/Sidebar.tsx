import type { Assistant } from "../../shared/types";
import { Icon, Nova, OkLine, Pet } from "./ui";

interface SidebarProps {
  assistants: Assistant[];
  selected: string | null;
  /** The assistants that are answering right now. */
  busy: Set<string>;
  onSelect(id: string): void;
  onNew(): void;
  onImport(): void;
  onModels(): void;
}

export function Sidebar({
  assistants,
  selected,
  busy,
  onSelect,
  onNew,
  onImport,
  onModels,
}: SidebarProps) {
  // Groups keep the order in which their first assistant was made.
  const groups = [...new Set(assistants.map((a) => a.group))];
  return (
    <nav className="sidebar" aria-label="Your assistants">
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-btn"
          aria-label="Import an assistant file"
          title="Import an assistant file"
          onClick={onImport}
        >
          <Icon name="upload" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="New assistant"
          title="New assistant"
          onClick={onNew}
        >
          <Icon name="plus" size={18} />
        </button>
      </div>

      <div className="brand">
        <Nova />
        <div className="brand-name">StellarFirm Open</div>
        <OkLine>Runs on this computer</OkLine>
      </div>

      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <div className="group-label">{group}</div>
          {assistants
            .filter((a) => a.group === group)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                className="row"
                aria-current={a.id === selected ? "true" : undefined}
                onClick={() => onSelect(a.id)}
              >
                <Pet pet={a.pet} color={a.color} />
                <span className="row-text">
                  <span className="row-name">{a.name}</span>
                  <span className="row-line">
                    {busy.has(a.id)
                      ? "Writing…"
                      : (a.lastLine ?? "No messages yet")}
                  </span>
                </span>
              </button>
            ))}
        </section>
      ))}

      <div className="sidebar-foot">
        <span className="row-text">
          <span className="row-name">Your keys, your models</span>
          <span className="row-line">Nothing is stored in a cloud</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Models"
          title="Models"
          onClick={onModels}
        >
          <Icon name="sliders" size={18} />
        </button>
      </div>
    </nav>
  );
}
