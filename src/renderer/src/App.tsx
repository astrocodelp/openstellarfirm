import { useCallback, useEffect, useState } from "react";
import type {
  ApprovalCard,
  AppState,
  Assistant,
  ChatMessage,
  Decision,
} from "../../shared/types";
import { availableUpdate } from "../../shared/update";
import { AssistantForm } from "./AssistantForm";
import { BackupScreen } from "./Backup";
import { api } from "./bridge";
import { ChatView } from "./ChatView";
import { ComputerPanel } from "./Computer";
import { ConnectionsScreen } from "./Connections";
import { MailScreen } from "./Mail";
import { ModelsScreen } from "./Models";
import { SettingsScreen } from "./Settings";
import { Sidebar } from "./Sidebar";
import { UpdateNotice } from "./UpdateNotice";
import { ErrorLine, message as errorText, Nova } from "./ui";
import { Welcome } from "./Welcome";

type View =
  | { name: "chat" }
  | { name: "assistant"; id?: string }
  | { name: "models" }
  | { name: "connections" }
  | { name: "mail" }
  | { name: "backup" }
  | { name: "settings" };

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "chat" });
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  /** The answer so far, by assistant. A key here means it is answering. */
  const [streams, setStreams] = useState<Record<string, string>>({});
  /** What each answering assistant is doing right now. */
  const [activity, setActivity] = useState<Record<string, string>>({});
  /** The step that waits for the person, by assistant. */
  const [approvals, setApprovals] = useState<Record<string, ApprovalCard>>({});
  /**
   * Whether each assistant's computer panel is open. Missing means the person
   * has not chosen: then it opens by itself when the assistant uses its computer.
   */
  const [computerOpen, setComputerOpen] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState();
      document.documentElement.dataset.platform = next.platform;
      document.documentElement.dataset.textSize = next.settings.textSize;
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
    const offActivity = api.onActivity(({ assistantId, label }) => {
      setActivity((a) => ({ ...a, [assistantId]: label }));
      if (/its computer/.test(label))
        setComputerOpen((open) =>
          assistantId in open ? open : { ...open, [assistantId]: true },
        );
    });
    const offApproval = api.onApproval(({ assistantId, card }) => {
      setApprovals((a) =>
        card ? { ...a, [assistantId]: card } : without(a, assistantId),
      );
    });
    const offDone = api.onDone(({ assistantId, message, request }) => {
      setStreams((s) => without(s, assistantId));
      setActivity((a) => without(a, assistantId));
      setApprovals((a) => without(a, assistantId));
      setChats((c) => {
        const loaded = c[assistantId];
        return loaded
          ? {
              ...c,
              [assistantId]: [
                ...loaded,
                ...(request ? [request] : []),
                message,
              ],
            }
          : c;
      });
      void refresh();
    });
    return () => {
      offDelta();
      offActivity();
      offApproval();
      offDone();
    };
  }, [refresh]);

  // Load a chat, and any step that waits in it, the first time it is opened.
  useEffect(() => {
    if (!selected || chats[selected]) return;
    let live = true;
    Promise.all([api.messages(selected), api.pending(selected)])
      .then(([messages, card]) => {
        if (!live) return;
        setChats((c) => (c[selected] ? c : { ...c, [selected]: messages }));
        if (card) {
          setApprovals((a) => ({ ...a, [selected]: card }));
          setStreams((s) => ({ ...s, [selected]: s[selected] ?? "" }));
        }
      })
      .catch((e) => setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [selected, chats]);

  // An update from a check counts as seen once its chat is open.
  const unreadMain = state?.settings.checkUnread
    ? state.settings.mainAssistantId
    : undefined;
  useEffect(() => {
    if (unreadMain && unreadMain === selected && view.name === "chat") {
      void api
        .setSettings({ checkUnread: false })
        .then(refresh)
        .catch(() => undefined);
    }
  }, [unreadMain, selected, view.name, refresh]);

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

  async function act(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
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
          onCloud={() => void act(() => api.openCloud("home"))}
        />
        <ErrorLine>{error}</ErrorLine>
      </>
    );
  }

  const newVersion = availableUpdate(state.settings, state.version);
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

  async function decide(card: ApprovalCard, decision: Decision) {
    await api.decide(card.assistantId, card.id, decision);
    // "Always allow" saved a site, so the assistant's own list changed.
    if (decision === "always") await refresh();
  }

  async function importFile() {
    await act(async () => {
      const imported = await api.importAssistant();
      if (!imported) return;
      await refresh();
      setSelected(imported.id);
      setView({ name: "chat" });
    });
  }

  return (
    <div className="app">
      <Sidebar
        assistants={state.assistants}
        selected={view.name === "chat" ? selected : null}
        busy={new Set(Object.keys(streams))}
        waiting={new Set(Object.keys(approvals))}
        unread={new Set(unreadMain ? [unreadMain] : [])}
        showCloudCard={!state.settings.hideCloudCard}
        current={
          view.name === "models" ||
          view.name === "connections" ||
          view.name === "mail" ||
          view.name === "backup" ||
          view.name === "settings"
            ? view.name
            : undefined
        }
        notice={
          newVersion ? (
            <UpdateNotice
              version={newVersion}
              onSee={() => void act(() => api.openLink("release"))}
              onDismiss={() =>
                void act(async () => {
                  await api.dismissUpdate();
                  await refresh();
                })
              }
            />
          ) : null
        }
        onSelect={(id) => {
          setSelected(id);
          setView({ name: "chat" });
        }}
        onNew={() => setView({ name: "assistant" })}
        onImport={() => void importFile()}
        onBackup={() => setView({ name: "backup" })}
        onModels={() => setView({ name: "models" })}
        onSettings={() => setView({ name: "settings" })}
        onConnections={() => setView({ name: "connections" })}
        onMail={() => setView({ name: "mail" })}
        onCloud={() => void act(() => api.openCloud("home"))}
        onHideCloudCard={() =>
          void act(async () => {
            await api.setSettings({ hideCloudCard: true });
            await refresh();
          })
        }
      />
      <main className="main">
        {error ? (
          <div style={{ padding: "0.75rem 1.25rem 0" }}>
            <ErrorLine>{error}</ErrorLine>
          </div>
        ) : null}
        {view.name === "settings" ? (
          <SettingsScreen
            state={state}
            onChanged={refresh}
            onBack={() => setView({ name: "chat" })}
            onBackup={() => setView({ name: "backup" })}
            onChatsDeleted={() => setChats({})}
          />
        ) : view.name === "backup" ? (
          <BackupScreen
            onChanged={() => void refresh()}
            onBack={() => setView({ name: "chat" })}
            onCloud={() => void act(() => api.openCloud("home"))}
          />
        ) : view.name === "connections" ? (
          <ConnectionsScreen
            state={state}
            onChanged={refresh}
            onBack={() => setView({ name: "chat" })}
          />
        ) : view.name === "mail" ? (
          <MailScreen
            state={state}
            onChanged={refresh}
            onBack={() => setView({ name: "chat" })}
          />
        ) : view.name === "models" ? (
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
            connections={state.connections}
            mailAccounts={state.mailAccounts}
            assistants={state.assistants}
            onSaved={(saved) => {
              void refresh().then(() => {
                setSelected(saved.id);
                setView({ name: "chat" });
              });
            }}
            onChanged={() => void refresh()}
            onRemoved={() => {
              setView({ name: "chat" });
              void refresh();
            }}
            onCancel={() => setView({ name: "chat" })}
          />
        ) : assistant ? (
          <div className="chat-row">
            <div className="chat-pane">
              <ChatView
                headExtra={
                  assistant.computer ? (
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={computerOpen[assistant.id] === true}
                      aria-controls="computer-panel"
                      onClick={() =>
                        setComputerOpen((open) => ({
                          ...open,
                          [assistant.id]: open[assistant.id] !== true,
                        }))
                      }
                    >
                      Computer
                    </button>
                  ) : null
                }
                assistant={assistant}
                modelLine={modelLine(assistant)}
                messages={chats[assistant.id] ?? []}
                streaming={streams[assistant.id]}
                activity={activity[assistant.id]}
                approval={approvals[assistant.id]}
                onSend={(text) => send(assistant, text)}
                onStop={() => void api.stop(assistant.id)}
                onDecide={decide}
                onCustomize={() =>
                  setView({ name: "assistant", id: assistant.id })
                }
                onModels={() => setView({ name: "models" })}
                sendWith={state.settings.sendWith}
                mac={state.platform === "darwin"}
              />
            </div>
            {assistant.computer && computerOpen[assistant.id] === true ? (
              <ComputerPanel
                assistant={assistant}
                busy={streams[assistant.id] !== undefined}
                onStop={() => void api.stop(assistant.id)}
                onClose={() =>
                  setComputerOpen((open) => ({
                    ...open,
                    [assistant.id]: false,
                  }))
                }
              />
            ) : null}
          </div>
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
