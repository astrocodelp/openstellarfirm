import { Icon } from "./ui";

/** A small, quiet notice in the sidebar. It only tells; the person decides. */
export function UpdateNotice({
  version,
  onSee,
  onDismiss,
}: {
  version: string;
  onSee(): void;
  onDismiss(): void;
}) {
  return (
    <section className="cloud-card" aria-label="A new version">
      <div className="cloud-head">
        <span className="row-name">Version {version} is available</span>
        <button
          type="button"
          className="close-btn"
          aria-label="Dismiss this notice"
          title="Dismiss this notice"
          onClick={onDismiss}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <button type="button" className="btn" onClick={onSee}>
        See the release
        <Icon name="external" size={14} />
      </button>
    </section>
  );
}
