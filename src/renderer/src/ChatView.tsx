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
import { ErrorLine, message as errorText, Icon, Pet } from "./ui";

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
}

function Steps({ steps }: { steps: ChatStep[] }) {
  return (
    <ul className="steps" aria-label="What it did">
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once for each new card
  useEffect(() => {
    first.current?.focus();
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
      <div className="wrap">
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
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== undefined;
  const canAct =
    assistant.folders.length > 0 || assistant.web || assistant.screen === true;

  // Keep the newest text in view while an answer is written.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the chat's content changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, activity, approval?.id, assistant.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another assistant is opened
  useEffect(() => {
    setDraft("");
    setError("");
    box.current?.focus();
  }, [assistant.id]);

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
        <button type="button" className="btn" onClick={props.onCustomize}>
          Customize
        </button>
      </header>

      <div className="chat-scroll" ref={scroller}>
        {messages.length === 0 && !busy ? (
          <div className="empty">
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
                <button type="button" className="btn" onClick={props.onModels}>
                  Set up a model
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="chat-column" aria-live="polite">
            {messages.map((m) =>
              m.failed ? (
                <div key={m.id} className="turn">
                  {m.steps ? <Steps steps={m.steps} /> : null}
                  <p className="bubble bubble-failed">
                    <Icon name="alert" />
                    <span>{m.text}</span>
                  </p>
                </div>
              ) : m.role === "user" ? (
                <p key={m.id} className="bubble bubble-user">
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="turn">
                  {m.steps ? <Steps steps={m.steps} /> : null}
                  <p className="bubble">{m.text}</p>
                </div>
              ),
            )}
            {busy ? (
              <div className="turn">
                {streaming ? <p className="bubble">{streaming}</p> : null}
                {approval ? null : (
                  <p className="activity" role="status">
                    {activity ? `${activity}…` : "Thinking…"}
                  </p>
                )}
              </div>
            ) : null}
            {approval ? (
              <Approval
                card={approval}
                onDecide={(decision) => props.onDecide(approval, decision)}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <ErrorLine>{error}</ErrorLine>
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
            aria-describedby="send-hint"
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
          {sendHint(props.sendWith, props.mac)}
        </p>
      </div>
    </>
  );
}
