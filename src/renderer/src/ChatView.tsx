import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { plainText } from "../../shared/markdown";
import { type SendKey, sendHint, sendsMessage } from "../../shared/preferences";
import type {
  ApprovalCard,
  Assistant,
  ChatMessage,
  ChatStep,
  Decision,
} from "../../shared/types";
import { ReadAloud } from "./Accessibility";
import {
  AttachButton,
  PendingFiles,
  pastedFiles,
  SentFiles,
  useAttachments,
  useDropFiles,
} from "./Attachments";
import { refocusIfLost } from "./a11y";
import { api } from "./bridge";
import {
  CopyButton,
  type FoundMessage,
  SaveChatStatus,
  useFoundMessage,
  useSaveChat,
} from "./ChatTools";
import { StepFrame } from "./Computer";
import { Markdown } from "./Markdown";
import {
  ContextBar,
  contextUse,
  ForgetButton,
  ForgotLine,
  RememberedStep,
  SummaryBlock,
  SummaryOffer,
  useChatTools,
  useMemory,
} from "./Memory";
import { MoreMenu } from "./MoreMenu";
import { ErrorLine, message as errorText, Icon, Pet } from "./ui";

/** How close to the end of the chat still counts as "at the end". */
const PINNED_WITHIN = 32;

/**
 * A message saved in the last few seconds arrived while the chat was open, so
 * it enters with a short motion. History that was already there does not.
 */
function fresh(m: ChatMessage): boolean {
  return Date.now() - Date.parse(m.at) < 4000;
}

/** What the person decided on the card, kept for the rest of the turn. */
interface Resolved {
  id: string;
  title: string;
  decision: Decision;
  /** The activity line when they decided, which is no longer true after. */
  activity: string | undefined;
}

const OUTCOME: Record<Decision, string> = {
  approve: "Approved",
  always: "Always allowed",
  reject: "Rejected",
};

interface ChatViewProps {
  assistant: Assistant;
  /** One line that says which model answers, or none when no model is set up. */
  modelLine: string | null;
  messages: ChatMessage[];
  /** The answer so far while it is being written; undefined when idle. */
  streaming: string | undefined;
  /** What it is doing right now, such as "Reading notes.md". */
  activity: string | undefined;
  /** The step that waits for the person, if any. */
  approval: ApprovalCard | undefined;
  onSend(text: string, attachmentIds: string[]): Promise<void>;
  onStop(): void;
  onDecide(card: ApprovalCard, decision: Decision): Promise<void>;
  onCustomize(): void;
  onModels(): void;
  /** What sends a message, and whether the keys are a Mac's. */
  sendWith: SendKey;
  mac: boolean;
  /** Saves this chat as a Markdown file; false when the dialog was closed. */
  onSaveChat?(): Promise<boolean>;
  /** Copies one saved message, by its id. */
  onCopy?(messageId: string): Promise<void>;
  /** A message a search found in this chat, to bring into view. */
  found?: FoundMessage | undefined;
  /** How fast Read aloud reads an answer. */
  readRate?: number;
  /** The model that answers and its preset, for the context meter. */
  model?: string;
  preset?: string;
  /** The chat after a message was forgotten, the chat cleared or summed up. */
  onChatChanged(messages: ChatMessage[]): void;
  /** More buttons in the head, before Customize. */
  headExtra?: ReactNode;
  /** A quiet line under the empty chat's words. */
  emptyExtra?: ReactNode;
}

/** The time a check started, as the person's computer writes it. */
function clock(at: string): string {
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Steps({
  steps,
  enter,
  noteIds,
  onUndoNote,
  assistantId,
}: {
  steps: ChatStep[];
  enter: boolean;
  /** Whose computer a step's picture is from. */
  assistantId: string;
  /** The notes still in memory, so a saved note offers Undo only while it is there. */
  noteIds?: Set<string> | undefined;
  onUndoNote?: (id: string) => Promise<void>;
}) {
  return (
    <ul className={enter ? "steps enter" : "steps"} aria-label="What it did">
      {steps.map((step, index) => {
        const note = step.note;
        return note && onUndoNote ? (
          <RememberedStep
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list that never reorders
            key={index}
            step={{ ...step, note }}
            kept={noteIds ? noteIds.has(note.id) : undefined}
            onUndo={() => onUndoNote(note.id)}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list that never reorders
          <li key={index} className={step.ok ? "step" : "step step-failed"}>
            <Icon name={step.ok ? "check" : "alert"} size={14} />
            <span>{step.label}</span>
            {step.frame ? (
              <StepFrame
                assistantId={assistantId}
                frameId={step.frame}
                label={step.label}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * How long after a card shows before Approve and Always allow take a press.
 * A key held down, or a click meant for what was there a moment before, must
 * never approve a step the person has not read.
 */
export const ARMING_MS = 500;

/** The card for a step that waits. Approve is the view's one lime button. */
function Approval({
  card,
  onDecide,
}: {
  card: ApprovalCard;
  onDecide(decision: Decision): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const section = useRef<HTMLElement>(null);

  // The focus never lands on Approve by itself. When the person is not
  // typing somewhere, it moves to the card, which reads out what waits; from
  // there Approve is one deliberate Tab away. The app's live region says a
  // step waits either way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once for each new card
  useEffect(() => {
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), ARMING_MS);
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (!typing) section.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(timer);
  }, [card.id]);

  async function decide(decision: Decision) {
    // Approve and Always allow wait out the arming time; Reject never does.
    if (decision !== "reject" && !armed) return;
    setBusy(true);
    setError("");
    try {
      await onDecide(decision);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <section
      ref={section}
      className="approval"
      aria-labelledby={`approval-${card.id}`}
      aria-describedby={`approval-why-${card.id}`}
      tabIndex={-1}
    >
      <div className="approval-kicker">
        <span className="dot" aria-hidden="true" />
        Waiting for your Approve
      </div>
      <h2 className="section-title" id={`approval-${card.id}`}>
        {card.title}
      </h2>
      {/* Everything the step would send, whole: long details scroll here, so the keyboard can reach them. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a named group for the details, not a fieldset of a form */}
      <div
        className="mono approval-detail"
        role="group"
        aria-label="What it would do, in full"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must take the focus
        tabIndex={0}
      >
        {card.detail}
      </div>
      <p className="faint" id={`approval-why-${card.id}`}>
        Why it asks: {card.why}
      </p>
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap" aria-busy={busy || undefined}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          aria-disabled={!armed || undefined}
          onClick={() => void decide("approve")}
        >
          Approve
        </button>
        {card.site || card.canAlways ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            aria-disabled={!armed || undefined}
            onClick={() => void decide("always")}
          >
            {card.site ? `Always allow ${card.site}` : "Always allow this read"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void decide("reject")}
        >
          Reject
        </button>
      </div>
    </section>
  );
}

export function ChatView(props: ChatViewProps) {
  const { assistant, modelLine, messages, streaming, activity, approval } =
    props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  /** A copy or a save that failed: about that button, not about the message box. */
  const [actionError, setActionError] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  /** True while Clear chat asks whether to clear. */
  const [clearing, setClearing] = useState(false);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  /** Keep it or Escape on Clear chat's question: the focus goes back to More. */
  const backToMore = useRef(false);
  /** True when the person scrolled up, away from the newest text. */
  const [away, setAway] = useState(false);
  const pinned = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== undefined;
  const files = useAttachments(assistant.id);
  const drop = useDropFiles(files, true);
  const canAct =
    assistant.folders.length > 0 ||
    assistant.web ||
    assistant.screen === true ||
    assistant.computer !== undefined;
  const [memory, setMemory] = useMemory(assistant.id, messages.length);
  const tools = useChatTools(
    assistant.id,
    props.onChatChanged,
    () => box.current,
  );
  const use = contextUse({
    assistant,
    memory,
    messages,
    ...(props.model ? { model: props.model } : {}),
    ...(props.preset ? { preset: props.preset } : {}),
  });
  const noteIds = memory ? new Set(memory.notes.map((n) => n.id)) : undefined;
  const saveChat = useSaveChat(props.onSaveChat, setActionError);

  useEffect(() => {
    if (clearing || !backToMore.current) return;
    backToMore.current = false;
    moreButton.current?.focus({ preventScroll: true });
  }, [clearing]);

  const empty = messages.length === 0;
  const waitWhy = "Wait until it has answered.";
  const menu = [
    ...(saveChat.can
      ? [
          {
            id: "save",
            label: "Save this chat",
            disabledWhy: empty
              ? "There is nothing in this chat to save yet."
              : saveChat.state === "saving"
                ? "Saving…"
                : undefined,
            onSelect: () => void saveChat.save(),
          },
        ]
      : []),
    {
      id: "summarise",
      label: "Summarise and continue",
      disabledWhy: empty
        ? "There is nothing to summarise yet."
        : busy
          ? waitWhy
          : tools.working || tools.summarising
            ? "The chat is being changed."
            : undefined,
      onSelect: () => void tools.summarise(),
    },
    {
      id: "clear",
      label: "Clear chat",
      disabledWhy: empty
        ? "The chat is already empty."
        : busy
          ? waitWhy
          : tools.working
            ? "The chat is being changed."
            : undefined,
      onSelect: () => setClearing(true),
    },
  ];
  async function undoNote(id: string) {
    setMemory(await api.removeNote(assistant.id, id));
    // Undo went with the note; the caret goes back to the message box.
    refocusIfLost(() => box.current);
  }

  /** One saved message, as the chat shows it. */
  /** One saved message; an answer's Forget sits in its row of actions. */
  function renderMessage(m: ChatMessage, forget?: ReactNode) {
    return m.check === "request" ? (
      <p key={m.id} className="check-note" data-message-id={m.id}>
        <Icon name="check" size={14} />
        <span>Started a check at {clock(m.at)}</span>
      </p>
    ) : m.failed ? (
      <div key={m.id} className="turn" data-message-id={m.id}>
        {m.check ? <p className="check-note">Check update</p> : null}
        {m.steps ? (
          <Steps steps={m.steps} enter={fresh(m)} assistantId={assistant.id} />
        ) : null}
        <p
          className={[
            "bubble bubble-failed",
            stoppedByPerson(m) ? "bubble-stopped" : "",
            fresh(m) ? "enter" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <Icon name={stoppedByPerson(m) ? "stop" : "alert"} />
          <span>{m.text}</span>
        </p>
      </div>
    ) : m.role === "user" && m.attachments?.length ? (
      <div key={m.id} className="user-turn" data-message-id={m.id}>
        <SentFiles assistantId={assistant.id} files={m.attachments} />
        {m.text ? (
          <p
            className={
              fresh(m) ? "bubble bubble-user enter" : "bubble bubble-user"
            }
          >
            {m.text}
          </p>
        ) : null}
      </div>
    ) : m.role === "user" && m.from === "pet" ? (
      <div key={m.id} className="user-turn" data-message-id={m.id}>
        <p className="from-note">From a desk pet</p>
        <p
          className={
            fresh(m) ? "bubble bubble-user enter" : "bubble bubble-user"
          }
        >
          {m.text}
        </p>
      </div>
    ) : m.role === "user" ? (
      <p
        key={m.id}
        data-message-id={m.id}
        className={fresh(m) ? "bubble bubble-user enter" : "bubble bubble-user"}
      >
        {m.text}
      </p>
    ) : (
      <div key={m.id} className="turn" data-message-id={m.id}>
        {m.check ? <p className="check-note">Check update</p> : null}
        {m.steps ? (
          <Steps
            steps={m.steps}
            enter={fresh(m)}
            assistantId={assistant.id}
            noteIds={noteIds}
            onUndoNote={undoNote}
          />
        ) : null}
        {/* The streamed answer already entered, so the saved one does not. */}
        <div className="bubble bubble-answer md">
          <Markdown
            text={m.text}
            onOpenLink={(href) => api.openAnswerLink(assistant.id, m.id, href)}
            onCopyCode={(index) => api.copyCode(assistant.id, m.id, index)}
            onError={setActionError}
          />
        </div>
        {/* Copy and Read aloud sit side by side, under the start of the answer. */}
        <div className="turn-actions">
          {props.onCopy ? (
            <CopyButton
              onCopy={() => props.onCopy?.(m.id) ?? Promise.resolve()}
              onError={setActionError}
            />
          ) : null}
          <ReadAloud
            id={m.id}
            text={plainText(m.text, { links: "words" })}
            rate={props.readRate ?? 1}
          />
          {forget}
        </div>
      </div>
    );
  }

  function toEnd() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Keep the newest text in view while an answer is written, but only while
  // the person is at the end: once they scroll up to read, they stay there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the chat's content changes
  useLayoutEffect(() => {
    if (pinned.current) toEnd();
  }, [messages.length, streaming, activity, approval?.id, resolved, busy]);

  // The column also changes size without a render: a window resize, the text
  // size setting, a font that arrives late. The end stays in view then too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: watch the column of each chat
  useEffect(() => {
    const el = column.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) toEnd();
    });
    observer.observe(el);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [assistant.id, messages.length === 0 && !busy]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const atEnd =
      el.scrollHeight - el.scrollTop - el.clientHeight <= PINNED_WITHIN;
    pinned.current = atEnd;
    setAway(!atEnd);
  }

  function jumpToLatest() {
    pinned.current = true;
    setAway(false);
    toEnd();
    box.current?.focus({ preventScroll: true });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another assistant is opened
  useEffect(() => {
    setDraft("");
    setError("");
    setResolved(null);
    pinned.current = true;
    setAway(false);
    toEnd();
    box.current?.focus();
  }, [assistant.id]);

  // The outcome line belongs to the turn; it goes when the turn is over.
  useEffect(() => {
    if (!busy) setResolved(null);
  }, [busy]);

  // A message found by a search: after the reset above, so it keeps the focus.
  // A chat too short to scroll stays at its end; the scroll that follows says
  // where a longer one is.
  useFoundMessage(props.found, messages, column, () => {
    const el = scroller.current;
    const scrolls = !!el && el.scrollHeight - el.clientHeight > PINNED_WITHIN;
    pinned.current = !scrolls;
    setAway(scrolls);
  });

  // The box grows with its text, up to the cap in the stylesheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize when the text changes
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  async function send() {
    const text = draft.trim();
    const ids = files.files.map((f) => f.id);
    if ((!text && ids.length === 0) || busy || files.adding) return;
    setError("");
    setActionError("");
    setDraft("");
    // Sending is a wish to see the answer, so the chat follows it again.
    pinned.current = true;
    setAway(false);
    files.clearProblem();
    try {
      await props.onSend(text, ids);
      await files.reload();
    } catch (e) {
      setDraft(text);
      setError(errorText(e));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The person's choice decides what sends; the other way is a new line.
    // Not while an input method is composing.
    if (!event.nativeEvent.isComposing && sendsMessage(props.sendWith, event)) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <>
      <header className="chat-head">
        <Pet pet={assistant.pet} color={assistant.color} size={32} />
        <div className="row-text">
          <h1 className="chat-title">{assistant.name}</h1>
          <span className="faint">{modelLine ?? "No model is set up yet"}</span>
        </div>
        <div className="chat-head-actions">
          <SaveChatStatus state={saveChat.state} />
          {props.headExtra}
          <button type="button" className="btn" onClick={props.onCustomize}>
            Customize
          </button>
          <MoreMenu label="More" items={menu} buttonRef={moreButton} />
        </div>
      </header>
      <ContextBar
        tools={tools}
        use={use}
        clearing={clearing}
        onKeep={() => {
          backToMore.current = true;
          setClearing(false);
        }}
        onCleared={() => setClearing(false)}
      />

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={onScroll}
        {...drop.handlers}
      >
        {drop.over ? (
          // A line of no height, so the chat under it never moves.
          <div className="drop-note" aria-hidden="true">
            <span>Drop files to attach them</span>
          </div>
        ) : null}
        {messages.length === 0 && !busy ? (
          <div className="empty" key={assistant.id}>
            <Pet pet={assistant.pet} color={assistant.color} size={96} />
            <h2 className="section-title">
              Tell {assistant.name} what you need.
            </h2>
            {modelLine ? (
              <>
                <p className="dim">
                  {canAct
                    ? "It asks before it reaches a new website. It never changes or deletes a file."
                    : "Right now it can only talk. Pick folders or turn on web pages in Customize."}
                </p>
                {props.emptyExtra}
              </>
            ) : (
              <>
                <p className="dim">It needs a model to think with first.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={props.onModels}
                >
                  Set up a model
                </button>
              </>
            )}
          </div>
        ) : (
          // Not a live region: an answer is told once it is done, by the app's
          // one announcer, never word by word while it is written.
          <div className="chat-column" key={assistant.id} ref={column}>
            {messages
              .filter((m) => !m.summarised)
              .map((m) =>
                m.summary ? (
                  <SummaryBlock
                    key={m.id}
                    summary={m}
                    covered={messages.filter((c) => c.summarised === m.id)}
                    tools={tools}
                    busy={busy}
                    renderMessage={(c) => (
                      <div key={c.id} className={`msg msg-${c.role}`}>
                        {renderMessage(c)}
                      </div>
                    )}
                  />
                ) : (
                  <div key={m.id} className={`msg msg-${m.role}`}>
                    {isAnswer(m) ? (
                      renderMessage(
                        m,
                        <ForgetButton
                          tools={tools}
                          busy={busy}
                          messageId={m.id}
                        />,
                      )
                    ) : (
                      <>
                        {renderMessage(m)}
                        <ForgetButton
                          tools={tools}
                          busy={busy}
                          messageId={m.id}
                        />
                      </>
                    )}
                  </div>
                ),
              )}
            {busy && (streaming || !approval) ? (
              <div className="turn">
                {streaming ? (
                  // Links are words until the answer is saved: only a saved
                  // answer's link can be opened.
                  <div className="bubble bubble-answer md enter">
                    <Markdown text={streaming} streaming />
                  </div>
                ) : null}
                {resolved && !approval ? (
                  <p className="approval-outcome" role="status">
                    <Icon
                      name={resolved.decision === "reject" ? "close" : "check"}
                      size={14}
                    />
                    <span>
                      {OUTCOME[resolved.decision]}: {resolved.title}
                    </span>
                  </p>
                ) : null}
                {approval ? null : (
                  <p className="activity" role="status">
                    <span className="pulse" aria-hidden="true" />
                    {activity && activity !== resolved?.activity
                      ? `${activity}…`
                      : streaming
                        ? "Writing…"
                        : "Thinking…"}
                  </p>
                )}
              </div>
            ) : null}
            {approval ? (
              <Approval
                card={approval}
                onDecide={async (decision) => {
                  await props.onDecide(approval, decision);
                  setResolved({
                    id: approval.id,
                    title: approval.title,
                    decision,
                    activity,
                  });
                  // The card is about to go; the caret goes back to the message box.
                  box.current?.focus({ preventScroll: true });
                }}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="composer-wrap" {...drop.handlers}>
        <button
          type="button"
          className="jump-latest"
          hidden={!away}
          onClick={jumpToLatest}
        >
          <Icon name="down" size={14} />
          Jump to latest
        </button>
        <ForgotLine tools={tools} />
        <SummaryOffer tools={tools} share={use.share} busy={busy} />
        <ErrorLine>{tools.error}</ErrorLine>
        <ErrorLine>{actionError}</ErrorLine>
        <ErrorLine id="send-error">{error || files.problem}</ErrorLine>
        <PendingFiles box={files} />
        <div className="composer">
          <AttachButton box={files} />
          <label className="visually-hidden" htmlFor="message-box">
            Message {assistant.name}
          </label>
          <textarea
            id="message-box"
            ref={box}
            rows={1}
            value={draft}
            placeholder={`Message ${assistant.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              const pasted = pastedFiles(event);
              if (pasted.length === 0) return;
              event.preventDefault();
              void files.addFiles(pasted);
            }}
            aria-describedby={
              error || files.problem ? "send-error send-hint" : "send-hint"
            }
          />
          {busy ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Stop"
              title="Stop"
              onClick={props.onStop}
            >
              <Icon name="stop" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn send"
              aria-label="Send"
              title="Send"
              disabled={
                (!draft.trim() && files.files.length === 0) || files.adding
              }
              onClick={() => void send()}
            >
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
        <p className="faint composer-hint" id="send-hint">
          {busy
            ? "It is answering. You can type now and send when it is done, or press Stop."
            : sendHint(props.sendWith, props.mac)}
        </p>
      </div>
    </>
  );
}

/**
 * A turn the person stopped before any words came. It is not an error, so it
 * does not look like one: no red, no warning sign.
 */
function stoppedByPerson(m: ChatMessage): boolean {
  return m.failed === true && m.text === "Stopped.";
}

/** A saved answer, the kind that has a row of actions under it. */
function isAnswer(m: ChatMessage): boolean {
  return m.role === "assistant" && !m.failed && m.check !== "request";
}
