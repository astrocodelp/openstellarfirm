import type { Assistant } from "../../shared/types";
import { Icon, Nova, OkLine, Pet } from "./ui";

interface SidebarProps {
  assistants: Assistant[];
  selected: string | null;
  /** The assistants that are answering right now. */
  busy: Set<string>;
  /** The assistants with a step that waits for the person. */
  waiting: Set<string>;
  showCloudCard: boolean;
  onSelect(id: string): void;
  onNew(): void;
  onImport(): void;
  onModels(): void;
  onSettings(): void;
  onCloud(): void;
  onHideCloudCard(): void;
}

export function Sidebar(props: SidebarProps) {
  const { assistants, selected, busy, waiting } = props;
  // Groups keep the order in which their first assistant was made.
  const groups = [...new Set(assistants.map((a) => a.group))];
  const line = (a: Assistant) => {
    if (waiting.has(a.id)) return "Waiting for your Approve";
    if (busy.has(a.id)) return "Working…";
    return a.lastLine ?? "No messages yet";
  };
  return (
    <nav className="sidebar" aria-label="Your assistants">
      <div className="sidebar-top">
        <button
          type="button"
          className="icon-btn"
          aria-label="Import an assistant file"
          title="Import an assistant file"
          onClick={props.onImport}
        >
          <Icon name="upload" size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="New assistant"
          title="New assistant"
          onClick={props.onNew}
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
                onClick={() => props.onSelect(a.id)}
              >
                <Pet pet={a.pet} color={a.color} />
                <span className="row-text">
                  <span className="row-name">{a.name}</span>
                  <span className="row-line">{line(a)}</span>
                </span>
                {waiting.has(a.id) ? (
                  <span className="dot" role="img" aria-label="Needs you" />
                ) : null}
              </button>
            ))}
        </section>
      ))}

      <div className="sidebar-end">
        {props.showCloudCard ? (
          <section className="cloud-card" aria-label="StellarFirm cloud">
            <div className="cloud-head">
              <span className="row-name">Need it in the cloud?</span>
              <button
                type="button"
                className="close-btn"
                aria-label="Hide this"
                title="Hide this"
                onClick={props.onHideCloudCard}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <p className="faint">
              StellarFirm gives you a team of assistants with their own cloud
              computers and your connected apps. They keep working when this
              computer is off.
            </p>
            <button type="button" className="btn" onClick={props.onCloud}>
              See StellarFirm
              <Icon name="external" size={14} />
            </button>
          </section>
        ) : null}
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
            onClick={props.onModels}
          >
            <Icon name="sliders" size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={props.onSettings}
          >
            <Icon name="gear" size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
