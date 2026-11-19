import { useState } from "react";
import type { AppState } from "../../shared/types";
import { api } from "./bridge";
import {
  Confirm,
  ErrorLine,
  plural,
  Section,
  useAction,
} from "./SettingsParts";
import { Icon, OkLine } from "./ui";

/** What the app remembers you approved, and the files it keeps. */

export function ApprovalsSection({
  state,
  onChanged,
}: {
  state: AppState;
  onChanged(): Promise<void>;
}) {
  const remembered = state.assistants.reduce(
    (n, a) =>
      n +
      a.sites.length +
      a.connectionTools.length +
      (a.mailReads?.length ?? 0),
    0,
  );
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState("");
  const { busy, error, run } = useAction();

  return (
    <Section section="approvals">
      <p className="faint">
        An assistant asks before it reads a website, uses a read-only tool of a
        connection, or reads a mail account, for the first time. If you choose
        "Always allow", the app remembers that site, that tool or that mailbox
        for that assistant only. Nothing else is remembered: a look at your
        screen and any tool that can change something ask every time.
      </p>
      <p>
        {remembered === 0
          ? "Nothing is remembered."
          : `${plural(remembered, "approval is", "approvals are")} remembered across your assistants.`}
      </p>
      {asking ? (
        <Confirm
          text="Every assistant will ask again before it reads any site, mailbox or connection, even the ones you allowed before. Your assistants, chats and folders stay as they are."
          doLabel="Ask again for everything"
          keepLabel="Keep them"
          busy={busy}
          onDo={() =>
            void run(async () => {
              const count = await api.clearApprovals();
              setAsking(false);
              setDone(
                `Done. ${plural(count, "approval", "approvals")} forgotten, so everything asks again.`,
              );
              await onChanged();
            })
          }
          onKeep={() => setAsking(false)}
        />
      ) : (
        <div className="wrap">
          <button
            type="button"
            className="btn"
            disabled={remembered === 0}
            onClick={() => {
              setDone("");
              setAsking(true);
            }}
          >
            Ask again for everything
          </button>
        </div>
      )}
      <div aria-live="polite">
        {done ? <OkLine parentAnnounces>{done}</OkLine> : null}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}

export function DataSection({
  dataDir,
  onBackup,
  onChatsDeleted,
  onChanged,
}: {
  dataDir: string;
  onBackup(): void;
  onChatsDeleted(): void;
  onChanged(): Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState("");
  const { busy, error, run } = useAction();

  return (
    <Section section="data">
      <p className="faint">
        Everything is saved in this folder on this computer, and nowhere else.
      </p>
      <p className="data-path mono">{dataDir}</p>
      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(() => api.openDataFolder())}
        >
          <Icon name="folder" />
          Open the data folder
        </button>
        <button type="button" className="btn" onClick={onBackup}>
          <Icon name="download" />
          Move or back up
        </button>
      </div>
      {asking ? (
        <Confirm
          text="This deletes every chat with every assistant. Your assistants stay. It cannot be undone."
          doLabel="Delete all chats"
          keepLabel="Keep my chats"
          busy={busy}
          onDo={() =>
            void run(async () => {
              const count = await api.deleteAllChats();
              setAsking(false);
              setDone(
                count === 0
                  ? "There were no chats to delete."
                  : `${plural(count, "chat", "chats")} deleted.`,
              );
              onChatsDeleted();
              await onChanged();
            })
          }
          onKeep={() => setAsking(false)}
        />
      ) : (
        <div className="wrap">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              setDone("");
              setAsking(true);
            }}
          >
            Delete all chats
          </button>
        </div>
      )}
      <div aria-live="polite">
        {done ? <OkLine parentAnnounces>{done}</OkLine> : null}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}
