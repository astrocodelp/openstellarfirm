import { Icon } from "./ui";

/**
 * A small, quiet notice in the sidebar. It only tells; the person decides.
 * Download is its own first action but not lime: the screen beside it keeps
 * the one lime button of the view.
 */
export function UpdateNotice({
  version,
  canDownload,
  onDownload,
  onSee,
  onDismiss,
}: {
  version: string;
  /** False where the release has no file for this computer. */
  canDownload: boolean;
  onDownload(): void;
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
      <p className="faint">Install it as you did the first time.</p>
      <div className="update-actions">
        {canDownload ? (
          <button
            type="button"
            className="btn btn-small cloud-btn"
            onClick={onDownload}
          >
            Download {version}
            <Icon name="external" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className={canDownload ? "link-btn" : "btn btn-small cloud-btn"}
          onClick={onSee}
        >
          See what's new
        </button>
      </div>
    </section>
  );
}
