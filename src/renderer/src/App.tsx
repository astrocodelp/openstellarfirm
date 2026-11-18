import { useCallback, useEffect, useState } from "react";
import type { AppState, Assistant, ChatMessage } from "../../shared/types";
import { AssistantForm } from "./AssistantForm";
import { api } from "./bridge";
import { ChatView } from "./ChatView";
import { ModelsScreen } from "./Models";
import { Sidebar } from "./Sidebar";
import { ErrorLine, message as errorText, Nova } from "./ui";
import { Welcome } from "./Welcome";

type View =
  | { name: "chat" }
  | { name: "assistant"; id?: string }
  | { name: "models" };

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "chat" });
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  /** The answer so far, by assistant. A key here means it is answering. */
  const [streams, setStreams] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState();
      document.documentElement.dataset.platform = next.platform;
      setState(next);
      setSelected((current) =>
        current && next.assistants.some((a) => a.id === current)
          ? current
          : (next.assistants[0]?.id ?? null),
      );
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offDelta = api.onDelta(({ assistantId, text }) => {
      setStreams((s) => ({
        ...s,
        [assistantId]: (s[assistantId] ?? "") + text,
      }));
    });
    const offDone = api.onDone(({ assistantId, message }) => {
      setStreams(({ [assistantId]: _finished, ...rest }) => rest);
      setChats((c) => {
        const loaded = c[assistantId];
        return loaded ? { ...c, [assistantId]: [...loaded, message] } : c;
      });
      void refresh();
    });
    return () => {
      offDelta();
      offDone();
    };
  }, [refresh]);

  // Load a chat the first time its assistant is opened.
  useEffect(() => {
    if (!selected || chats[selected]) return;
    let live = true;
    api
      .messages(selected)
      .then((messages) => {
        if (live)
          setChats((c) => (c[selected] ? c : { ...c, [selected]: messages }));
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [selected, chats]);

  if (!state) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <Nova />
        <ErrorLine>{error}</ErrorLine>
      </div>
    );
  }

  async function finishWelcome() {
    try {
      const current = await api.getState();
      if (current.assistants.length === 0) {
        await api.saveAssistant({
          name: "My assistant",
          group: "Personal",
          pet: "glim",
          color: "lime",
          brief: "",
          skills: ["write", "summarise"],
        });
      }
      await api.setSettings({ onboarded: true });
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (!state.settings.onboarded) {
    return (
      <>
        <Welcome
          keychain={state.keychain}
          onDone={() => void finishWelcome()}
        />
        <ErrorLine>{error}</ErrorLine>
      </>
    );
  }

  const assistant = state.assistants.find((a) => a.id === selected);
  const editing =
    view.name === "assistant"
      ? state.assistants.find((a) => a.id === view.id)
      : undefined;

  function modelLine(a: Assistant): string | null {
    const source = state?.sources.find(
      (s) => s.id === (a.sourceId ?? state.settings.defaultSourceId),
    );
    return source ? `${a.model ?? source.model} · ${source.name}` : null;
  }

  async function send(a: Assistant, text: string) {
    const sent = await api.send(a.id, text);
    setChats((c) => ({ ...c, [a.id]: [...(c[a.id] ?? []), sent] }));
    setStreams((s) => ({ ...s, [a.id]: s[a.id] ?? "" }));
  }

  async function importFile() {
    setError("");
    try {
      const imported = await api.importAssistant();
      if (!imported) return;
      await refresh();
      setSelected(imported.id);
      setView({ name: "chat" });
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="app">
      <Sidebar
        assistants={state.assistants}
        selected={view.name === "chat" ? selected : null}
        busy={new Set(Object.keys(streams))}
        onSelect={(id) => {
          setSelected(id);
          setView({ name: "chat" });
        }}
        onNew={() => setView({ name: "assistant" })}
        onImport={() => void importFile()}
        onModels={() => setView({ name: "models" })}
      />
      <main className="main">
        {error ? (
          <div style={{ padding: "0.75rem 1.25rem 0" }}>
            <ErrorLine>{error}</ErrorLine>
          </div>
        ) : null}
        {view.name === "models" ? (
          <ModelsScreen
            state={state}
            onChanged={refresh}
            onBack={() => setView({ name: "chat" })}
          />
        ) : view.name === "assistant" ? (
          <AssistantForm
            key={view.id ?? "new"}
            assistant={editing}
            sources={state.sources}
            onSaved={(saved) => {
              void refresh().then(() => {
                setSelected(saved.id);
                setView({ name: "chat" });
              });
            }}
            onRemoved={() => {
              setView({ name: "chat" });
              void refresh();
            }}
            onCancel={() => setView({ name: "chat" })}
          />
        ) : assistant ? (
          <ChatView
            assistant={assistant}
            modelLine={modelLine(assistant)}
            messages={chats[assistant.id] ?? []}
            streaming={streams[assistant.id]}
            onSend={(text) => send(assistant, text)}
            onStop={() => void api.stop(assistant.id)}
            onCustomize={() => setView({ name: "assistant", id: assistant.id })}
            onModels={() => setView({ name: "models" })}
          />
        ) : (
          <div className="empty">
            <Nova size={96} />
            <h1 className="section-title">Make your first assistant.</h1>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setView({ name: "assistant" })}
            >
              New assistant
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
