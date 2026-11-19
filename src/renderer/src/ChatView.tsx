import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  CopyButton,
  type FoundMessage,
  SaveChatButton,
  useFoundMessage,
} from "./ChatTools";
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
  onSend(text: string): Promise<void>;
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
}

/** The time a check started, as the person's computer writes it. */
function clock(at: string): string {
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? ""
    : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Steps({ steps, enter }: { steps: ChatStep[]; enter: boolean }) {
  return (
    <ul className={enter ? "steps enter" : "steps"} aria-label="What it did">
      {steps.map((step, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list that never reorders
        <li key={index} className={step.ok ? "step" : "step step-failed"}>
          <Icon name={step.ok ? "check" : "alert"} size={14} />
          <span>{step.label}</span>
        </li>
      ))}
    </ul>
  );
}

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
  const first = useRef<HTMLButtonElement>(null);

  // Focus moves to the card only when the person is not typing somewhere:
  // a key pressed mid-sentence must never land on Approve. The app's live
  // region says a step waits either way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once for each new card
  useEffect(() => {
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (!typing) first.current?.focus({ preventScroll: true });
  }, [card.id]);

  async function decide(decision: Decision) {
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
    <section className="approval" aria-labelledby={`approval-${card.id}`}>
      <div className="approval-kicker">
        <span className="dot" aria-hidden="true" />
        Waiting for your Approve
      </div>
      <h2 className="section-title" id={`approval-${card.id}`}>
        {card.title}
      </h2>
      <p className="mono approval-detail">{card.detail}</p>
      <p className="faint">Why it asks: {card.why}</p>
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap" aria-busy={busy || undefined}>
        <button
          ref={first}
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void decide("approve")}
        >
          Approve
        </button>
        {card.site || card.canAlways ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
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
  const [resolved, setResolved] = useState<Resolved | null>(null);
  /** True when the person scrolled up, away from the newest text. */
  const [away, setAway] = useState(false);
  const pinned = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== undefined;
  const canAct =
    assistant.folders.length > 0 || assistant.web || assistant.screen === true;

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
    if (!text || busy) return;
    setError("");
    setDraft("");
    // Sending is a wish to see the answer, so the chat follows it again.
    pinned.current = true;
    setAway(false);
    try {
      await props.onSend(text);
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
        {props.onSaveChat ? (
          <SaveChatButton
            disabled={messages.length === 0}
            onSave={props.onSaveChat}
            onError={setError}
          />
        ) : null}
        <button type="button" className="btn" onClick={props.onCustomize}>
          Customize
        </button>
      </header>

      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {messages.length === 0 && !busy ? (
          <div className="empty" key={assistant.id}>
            <Pet pet={assistant.pet} color={assistant.color} size={96} />
            <h2 className="section-title">
              Tell {assistant.name} what you need.
            </h2>
            {modelLine ? (
              <p className="dim">
                {canAct
                  ? "It asks before it reaches a new website. It never changes or deletes a file."
                  : "Right now it can only talk. Pick folders or turn on web pages in Customize."}
              </p>
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
            {messages.map((m) =>
              m.check === "request" ? (
                <p key={m.id} className="check-note" data-message-id={m.id}>
                  <Icon name="check" size={14} />
                  <span>Started a check at {clock(m.at)}</span>
                </p>
              ) : m.failed ? (
                <div key={m.id} className="turn" data-message-id={m.id}>
                  {m.check ? <p className="check-note">Check update</p> : null}
                  {m.steps ? <Steps steps={m.steps} enter={fresh(m)} /> : null}
                  <p
                    className={
                      fresh(m)
                        ? "bubble bubble-failed enter"
                        : "bubble bubble-failed"
                    }
                  >
                    <Icon name="alert" />
                    <span>{m.text}</span>
                  </p>
                </div>
              ) : m.role === "user" ? (
                <p
                  key={m.id}
                  data-message-id={m.id}
                  className={
                    fresh(m) ? "bubble bubble-user enter" : "bubble bubble-user"
                  }
                >
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="turn" data-message-id={m.id}>
                  {m.check ? <p className="check-note">Check update</p> : null}
                  {m.steps ? <Steps steps={m.steps} enter={fresh(m)} /> : null}
                  {/* The streamed answer already entered, so the saved one does not. */}
                  <p className="bubble bubble-answer">{m.text}</p>
                  {props.onCopy ? (
                    <CopyButton
                      onCopy={() => props.onCopy?.(m.id) ?? Promise.resolve()}
                      onError={setError}
                    />
                  ) : null}
                  <ReadAloud
                    id={m.id}
                    text={m.text}
                    rate={props.readRate ?? 1}
                  />
                </div>
              ),
            )}
            {busy && (streaming || !approval) ? (
              <div className="turn">
                {streaming ? (
                  <p className="bubble bubble-answer enter">{streaming}</p>
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

      <div className="composer-wrap">
        <button
          type="button"
          className="jump-latest"
          hidden={!away}
          onClick={jumpToLatest}
        >
          <Icon name="down" size={14} />
          Jump to latest
        </button>
        <ErrorLine id="send-error">{error}</ErrorLine>
        <div className="composer">
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
            aria-describedby={error ? "send-error send-hint" : "send-hint"}
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
              disabled={!draft.trim()}
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
