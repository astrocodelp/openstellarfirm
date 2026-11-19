import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CHARS_PER_TOKEN,
  contextShare,
  contextTokens,
  contextWindow,
  OFFER_SUMMARY_AT,
} from "../../shared/context";
import { MAX_NOTE_CHARS, MAX_NOTES } from "../../shared/memory";
import type {
  Assistant,
  AssistantMemory,
  ChatMessage,
  ChatStep,
} from "../../shared/types";
import { refocusIfLost } from "./a11y";
import { api } from "./bridge";
import {
  ErrorLine,
  message as errorText,
  Icon,
  InlineConfirm,
  OkLine,
} from "./ui";

/**
 * Memory and the chat's context, on the page. Everything here goes through the
 * bridge: the main process checks each value and keeps the files.
 */

/** An assistant's memory, loaded again whenever `version` changes. */
export function useMemory(
  assistantId: string | undefined,
  version: unknown,
): [AssistantMemory | null, (memory: AssistantMemory) => void] {
  const [memory, setMemory] = useState<AssistantMemory | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load again when the version changes
  useEffect(() => {
    if (!assistantId) return;
    let live = true;
    api
      .memory(assistantId)
      .then((m) => {
        if (live) setMemory(m);
      })
      .catch(() => {
        if (live) setMemory(null);
      });
    return () => {
      live = false;
    };
  }, [assistantId, version]);
  return [memory, setMemory];
}

const tokens = new Intl.NumberFormat("en-US");

/* ------------------------------------------------------------------------ */
/* The Memory section of an assistant's page                                 */
/* ------------------------------------------------------------------------ */

export function MemorySection({ assistant }: { assistant?: Assistant }) {
  if (!assistant) {
    return (
      <section className="stack-tight" aria-labelledby="memory-title">
        <h2 className="section-title" id="memory-title">
          Memory
        </h2>
        <p className="faint">Save it first. Then you can give it notes.</p>
      </section>
    );
  }
  return <Notes assistant={assistant} />;
}

function Notes({ assistant }: { assistant: Assistant }) {
  const [memory, setMemory] = useMemory(assistant.id, 0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ReactNode>("");
  const [busy, setBusy] = useState(false);
  /** The note just deleted, so Undo can add it again. */
  const [deleted, setDeleted] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  /** Back to the note's Edit button once its editor has gone. */
  function backToNote(id: string) {
    refocusIfLost(
      () =>
        listRef.current?.querySelector<HTMLElement>(
          `[data-note-edit="${CSS.escape(id)}"]`,
        ) ?? draftRef.current,
    );
  }

  function closeEdit() {
    const id = editing?.id;
    setEditing(null);
    if (id) backToNote(id);
  }

  async function act(
    change: () => Promise<AssistantMemory>,
    done?: ReactNode,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setMemory(await change());
      if (done) setStatus(done);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const text = draft.trim();
    if (!text) return;
    setDeleted(null);
    if (await act(() => api.addNote(assistant.id, text), "Note added"))
      setDraft("");
  }

  async function saveEdit() {
    if (!editing) return;
    const { id, text } = editing;
    if (await act(() => api.editNote(assistant.id, id, text), "Note saved")) {
      setEditing(null);
      backToNote(id);
    }
  }

  async function remove(id: string, text: string) {
    if (await act(() => api.removeNote(assistant.id, id))) {
      setDeleted(text);
      // The row went with its Delete button; Undo is the next thing wanted.
      refocusIfLost(() => undoRef.current);
    }
  }

  async function undoDelete() {
    const text = deleted;
    if (!text) return;
    if (await act(() => api.addNote(assistant.id, text), "Note is back")) {
      setDeleted(null);
      refocusIfLost(() => draftRef.current);
    }
  }

  /** Enter adds; the assistant form around this is never submitted from here. */
  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void add();
    }
  }

  function onEditKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeEdit();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveEdit();
    }
  }

  const notes = memory?.notes ?? [];
  const on = memory?.on ?? true;
  const full = notes.length >= MAX_NOTES;

  return (
    <section className="stack memory" aria-labelledby="memory-title">
      <div className="stack-tight">
        <h2 className="section-title" id="memory-title">
          Memory
        </h2>
        <p className="faint">
          Short notes {assistant.name} keeps in mind in every chat, such as
          “Prefers short answers”. They go to the model you chose with each
          message, so keep keys and passwords out. It can save a note itself
          when you tell it something worth keeping, and each one shows in the
          chat with Undo. Changes here are saved at once.
        </p>
      </div>

      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          checked={on}
          disabled={busy || !memory}
          onChange={(event) => {
            const next = event.target.checked;
            void act(
              () => api.setMemoryOn(assistant.id, next),
              next ? "Memory is on" : "Memory is off",
            );
          }}
        />
        <span>Use memory</span>
      </label>
      {!on ? (
        <p className="faint">
          Off: no note goes to the model and it cannot save one. Your notes stay
          here for when you turn it back on.
        </p>
      ) : null}

      {notes.length > 0 ? (
        <ul
          ref={listRef}
          className="list card"
          aria-label={`Notes for ${assistant.name}`}
        >
          {notes.map((note) =>
            editing?.id === note.id ? (
              <li key={note.id} className="memory-edit">
                <label className="field grow">
                  <span className="visually-hidden">Edit the note</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={editing.text}
                    maxLength={MAX_NOTE_CHARS}
                    // biome-ignore lint/a11y/noAutofocus: the person just pressed Edit on this note
                    autoFocus
                    onKeyDown={onEditKey}
                    onChange={(event) =>
                      setEditing({ id: note.id, text: event.target.value })
                    }
                  />
                </label>
                <div className="wrap">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !editing.text.trim()}
                    onClick={() => void saveEdit()}
                  >
                    {busy ? "Saving…" : "Save note"}
                  </button>
                  <button type="button" className="btn" onClick={closeEdit}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={note.id}>
                <span className="grow memory-text">
                  {note.text}
                  {note.by === "assistant" ? (
                    <span className="faint"> · Saved by {assistant.name}</span>
                  ) : null}
                </span>
                <div className="wrap memory-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    data-note-edit={note.id}
                    aria-label={`Edit the note “${short(note.text)}”`}
                    disabled={busy}
                    onClick={() => {
                      setDeleted(null);
                      setEditing({ id: note.id, text: note.text });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-small btn-danger"
                    aria-label={`Delete the note “${short(note.text)}”`}
                    disabled={busy}
                    onClick={() => void remove(note.id, note.text)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      ) : memory ? (
        <p className="faint">No notes yet.</p>
      ) : null}

      {deleted ? (
        <p className="memory-status" role="status">
          <span>Note deleted.</span>
          <button
            ref={undoRef}
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() => void undoDelete()}
          >
            Undo
          </button>
        </p>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="memory-draft">
          Add a note
        </label>
        <div className="wrap memory-add">
          <input
            ref={draftRef}
            id="memory-draft"
            className="input grow"
            value={draft}
            maxLength={MAX_NOTE_CHARS}
            disabled={full}
            placeholder="My name is Sam and I work in a bakery"
            autoComplete="off"
            onKeyDown={onDraftKey}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby="memory-count"
          />
          <button
            type="button"
            className="btn"
            disabled={busy || full || !draft.trim()}
            onClick={() => void add()}
          >
            <Icon name="plus" />
            Add note
          </button>
        </div>
        <span className="faint" id="memory-count">
          {full
            ? `Memory is full: ${MAX_NOTES} notes. Delete one to add another.`
            : `${notes.length} of ${MAX_NOTES} notes. Up to ${MAX_NOTE_CHARS} characters each.`}
        </span>
      </div>

      <ErrorLine>{error}</ErrorLine>
      {status ? <OkLine>{status}</OkLine> : null}
    </section>
  );
}

function short(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/* ------------------------------------------------------------------------ */
/* A note the assistant saved, shown in the chat with Undo                    */
/* ------------------------------------------------------------------------ */

export function RememberedStep({
  step,
  kept,
  onUndo,
}: {
  step: ChatStep & { note: { id: string; text: string } };
  /** False once the note is no longer in memory. Undefined while not known. */
  kept: boolean | undefined;
  onUndo(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <li className="step step-note">
      <Icon name="check" size={14} />
      <span>Remembered: {step.note.text}</span>
      {kept === false ? (
        <span className="faint">· Not in memory any more</span>
      ) : kept ? (
        <button
          type="button"
          className="link-btn step-undo"
          aria-label={`Undo: forget the note “${short(step.note.text)}”`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onUndo();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo
        </button>
      ) : null}
      {error ? <span className="step-error">{error}</span> : null}
    </li>
  );
}

/* ------------------------------------------------------------------------ */
/* The chat's context: the meter, Clear chat and Summarise and continue      */
/* ------------------------------------------------------------------------ */

/** What a chat's context tools do, shared by the bar, the messages and the offer. */
export function useChatTools(
  assistantId: string,
  onChatChanged: (messages: ChatMessage[]) => void,
  /** Where the focus goes when the button that ran a change went with it. */
  focusBox: () => HTMLElement | null | undefined,
) {
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [working, setWorking] = useState(false);
  /** "Not now" on the summary offer, for this chat. */
  const [offerDismissed, setOfferDismissed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another assistant is opened
  useEffect(() => {
    setError("");
    setForgot(false);
    setSummarising(false);
    setWorking(false);
    setOfferDismissed(false);
  }, [assistantId]);

  async function run(change: () => Promise<ChatMessage[]>): Promise<boolean> {
    setWorking(true);
    setError("");
    try {
      onChatChanged(await change());
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setWorking(false);
      // Keep summary, Undo, Clear: their buttons go with the change.
      refocusIfLost(focusBox);
    }
  }

  return {
    error,
    forgot,
    summarising,
    working,
    offerDismissed,
    dismissOffer: () => {
      setOfferDismissed(true);
      refocusIfLost(focusBox);
    },
    clearError: () => setError(""),
    async forget(messageId: string) {
      if (await run(() => api.forgetMessage(assistantId, messageId)))
        setForgot(true);
    },
    async undoForget() {
      if (await run(() => api.undoForget(assistantId))) setForgot(false);
    },
    async clear() {
      setForgot(false);
      return run(async () => {
        await api.clearChat(assistantId);
        return [];
      });
    },
    async summarise() {
      setForgot(false);
      setSummarising(true);
      try {
        return await run(() => api.summariseChat(assistantId));
      } finally {
        setSummarising(false);
        // The Stop link that had the focus has gone too.
        refocusIfLost(focusBox);
      }
    },
    stop() {
      void api.stop(assistantId);
    },
    keep(summaryId: string) {
      return run(() => api.keepSummary(assistantId, summaryId));
    },
    undo(summaryId: string) {
      return run(() => api.undoSummary(assistantId, summaryId));
    },
  };
}

export type ChatTools = ReturnType<typeof useChatTools>;

/** True while the long-chat offer shows, so the bar does not offer it twice. */
export function offerShown(
  tools: ChatTools,
  share: number | undefined,
): boolean {
  return (
    share !== undefined &&
    share >= OFFER_SUMMARY_AT &&
    !tools.offerDismissed &&
    !tools.summarising
  );
}

/** How full the model's window is, as an estimate. */
export function contextUse(input: {
  assistant: Assistant;
  memory: AssistantMemory | null;
  messages: ChatMessage[];
  model?: string;
  preset?: string;
}): { tokens: number; window: number | undefined; share: number | undefined } {
  const used = contextTokens({
    brief: input.assistant.brief,
    notes: input.memory?.on ? input.memory.notes.map((n) => n.text) : [],
    messages: input.messages,
  });
  const window = contextWindow(input.model, input.preset);
  return { tokens: used, window, share: contextShare(used, window) };
}

export function ContextBar({
  tools,
  use,
  hasMessages,
  busy,
}: {
  tools: ChatTools;
  use: ReturnType<typeof contextUse>;
  hasMessages: boolean;
  /** True while it is answering: the chat cannot change then. */
  busy: boolean;
}) {
  const [clearing, setClearing] = useState(false);
  const clearButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  /** Keep it or Esc: the focus goes back to Clear chat, which opened the question. */
  const backToClear = useRef(false);
  const percent =
    use.share === undefined ? undefined : Math.round(use.share * 100);

  useEffect(() => {
    if (clearing || !backToClear.current) return;
    backToClear.current = false;
    clearButton.current?.focus({ preventScroll: true });
  }, [clearing]);

  // The Summarise button that had the focus became this line: Stop takes it.
  useEffect(() => {
    if (!tools.summarising) return;
    const active = document.activeElement;
    if (!active || active === document.body)
      stopButton.current?.focus({ preventScroll: true });
  }, [tools.summarising]);

  function keep() {
    backToClear.current = true;
    setClearing(false);
  }

  // Always in place, empty before the first message, so the chat below never
  // jumps down when the first message is sent.
  if (!hasMessages && !tools.error)
    return <div className="context-bar" data-empty="true" />;
  return (
    <div className="context-bar">
      {percent !== undefined && use.window ? (
        <div
          className="context-meter"
          title={`About ${tokens.format(use.tokens)} of ${tokens.format(use.window)} tokens, counted at about ${CHARS_PER_TOKEN} characters a token.`}
          data-level={
            use.share !== undefined && use.share >= OFFER_SUMMARY_AT
              ? "high"
              : "normal"
          }
        >
          {/* The native meter is for assistive technology; the bar beside it is drawn. */}
          <meter
            className="visually-hidden"
            min={0}
            max={100}
            value={percent}
            aria-label={`The model's window is about ${percent}% full`}
          />
          <span className="context-track" aria-hidden="true">
            <span
              className="context-fill"
              style={{ transform: `scaleX(${use.share ?? 0})` }}
            />
          </span>
          <span className="faint" aria-hidden="true">
            About {percent}% full
          </span>
        </div>
      ) : (
        <span className="grow" />
      )}

      {tools.summarising ? (
        <p className="activity context-working" role="status">
          <span className="pulse" aria-hidden="true" />
          Summarising the older messages…
          <button
            ref={stopButton}
            type="button"
            className="link-btn"
            onClick={tools.stop}
          >
            Stop
          </button>
        </p>
      ) : clearing ? (
        <InlineConfirm
          className="context-confirm"
          label="Clear this chat"
          onClose={keep}
        >
          <span>Clear this chat? Its notes stay.</span>
          <button
            type="button"
            className="btn btn-danger btn-small"
            disabled={tools.working}
            onClick={() =>
              void tools.clear().then((ok) => {
                if (ok) setClearing(false);
              })
            }
          >
            Clear chat
          </button>
          <button
            data-autofocus
            type="button"
            className="btn btn-small"
            onClick={keep}
          >
            Keep it
          </button>
        </InlineConfirm>
      ) : hasMessages ? (
        <div className="wrap context-actions">
          {/* The offer below the chat asks the same, so it is not asked twice. */}
          {offerShown(tools, use.share) ? null : (
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || tools.working}
              onClick={() => void tools.summarise()}
            >
              Summarise and continue
            </button>
          )}
          <button
            ref={clearButton}
            type="button"
            className="btn btn-small"
            disabled={busy || tools.working}
            onClick={() => setClearing(true)}
          >
            Clear chat
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Offered when the chat passes 80% of the window. It never summarises on its own. */
export function SummaryOffer({
  tools,
  share,
  busy,
}: {
  tools: ChatTools;
  share: number | undefined;
  busy: boolean;
}) {
  if (share === undefined || !offerShown(tools, share)) return null;
  return (
    <section className="summary-offer" aria-label="This chat is getting long">
      <p>
        This chat fills about {Math.round(share * 100)}% of the model's window.
        Older messages may soon be left out. Summarise them and continue?
      </p>
      <div className="wrap">
        <button
          type="button"
          className="btn btn-small"
          disabled={busy || tools.working}
          onClick={() => void tools.summarise()}
        >
          Summarise and continue
        </button>
        <button
          type="button"
          className="btn btn-small"
          onClick={tools.dismissOffer}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

/** A summary in the chat. While it waits, the older messages are kept under it. */
export function SummaryBlock({
  summary,
  covered,
  tools,
  busy,
  renderMessage,
}: {
  summary: ChatMessage;
  covered: ChatMessage[];
  tools: ChatTools;
  busy: boolean;
  renderMessage(message: ChatMessage): ReactNode;
}) {
  const pending = summary.summary === "pending";
  return (
    <section
      className="summary"
      aria-label="Summary of earlier messages"
      data-message-id={summary.id}
    >
      <p className="summary-kicker">
        <Icon name="check" size={14} />
        {pending
          ? "Summary of earlier messages"
          : "Earlier messages, summed up"}
      </p>
      <p className="summary-text">{summary.text}</p>
      {pending ? (
        <>
          <p className="faint">
            {covered.length === 1
              ? "1 earlier message is no longer sent to the model."
              : `${covered.length} earlier messages are no longer sent to the model.`}{" "}
            They are kept until you choose. Keep the summary to delete them, or
            undo it to send them again.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || tools.working}
              onClick={() => void tools.keep(summary.id)}
            >
              Keep summary
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || tools.working}
              onClick={() => void tools.undo(summary.id)}
            >
              Undo
            </button>
          </div>
          {covered.length > 0 ? (
            <details className="summary-older">
              <summary>Show the earlier messages</summary>
              <div className="summary-older-list">
                {covered.map((m) => renderMessage(m))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** "Forget this message", under a message, and the line that offers it back. */
export function ForgetButton({
  tools,
  busy,
  messageId,
}: {
  tools: ChatTools;
  busy: boolean;
  messageId: string;
}) {
  return (
    <button
      type="button"
      className="forget-btn"
      aria-label="Forget this message"
      title="Take this message out of the chat. It is no longer sent to the model."
      disabled={busy || tools.working}
      onClick={() => void tools.forget(messageId)}
    >
      Forget
    </button>
  );
}

export function ForgotLine({ tools }: { tools: ChatTools }) {
  const undo = useRef<HTMLButtonElement>(null);
  // The Forget button went with its message, so the focus would be lost:
  // it lands on Undo instead, the one thing the person may want next.
  useEffect(() => {
    if (tools.forgot && document.activeElement === document.body)
      undo.current?.focus({ preventScroll: true });
  }, [tools.forgot]);
  if (!tools.forgot) return null;
  return (
    <p className="memory-status forgot-line" role="status">
      <span>Message forgotten. It is no longer sent to the model.</span>
      <button
        ref={undo}
        type="button"
        className="link-btn"
        disabled={tools.working}
        onClick={() => void tools.undoForget()}
      >
        Undo
      </button>
    </p>
  );
}
