import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Assistant, ChatMessage } from "../../shared/types";
import { ErrorLine, message as errorText, Icon, Pet } from "./ui";

interface ChatViewProps {
  assistant: Assistant;
  /** One line that says which model answers, or none when no model is set up. */
  modelLine: string | null;
  messages: ChatMessage[];
  /** The answer so far while it is being written; undefined when idle. */
  streaming: string | undefined;
  onSend(text: string): Promise<void>;
  onStop(): void;
  onCustomize(): void;
  onModels(): void;
}

export function ChatView(props: ChatViewProps) {
  const { assistant, modelLine, messages, streaming } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== undefined;

  // Keep the newest text in view while an answer is written.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the chat's content changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming, assistant.id]);

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
    // Enter sends; Shift+Enter is a new line. Not while an input method is composing.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
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
                In this version it can talk. It cannot open files or use apps
                yet.
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
                <p key={m.id} className="bubble bubble-failed">
                  <Icon name="alert" />
                  <span>{m.text}</span>
                </p>
              ) : (
                <p
                  key={m.id}
                  className={
                    m.role === "user" ? "bubble bubble-user" : "bubble"
                  }
                >
                  {m.text}
                </p>
              ),
            )}
            {busy ? <p className="bubble">{streaming || "Thinking…"}</p> : null}
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
      </div>
    </>
  );
}
