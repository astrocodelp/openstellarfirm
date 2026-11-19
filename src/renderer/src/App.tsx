import { useCallback, useEffect, useRef, useState } from "react";
import { cleanAccessibility } from "../../shared/accessibility";
import { downloadFile } from "../../shared/links";
import type {
  ApprovalCard,
  AppState,
  Assistant,
  ChatMessage,
  Decision,
} from "../../shared/types";
import { availableUpdate } from "../../shared/update";
import { ShortcutsDialog, SkipLinks, useShortcutsKey } from "./Accessibility";
import { AssistantForm } from "./AssistantForm";
import {
  afterPaint,
  announce,
  applyAccessibility,
  focusLost,
  refocusIfLost,
} from "./a11y";
import { api } from "./bridge";
import type { FoundMessage } from "./ChatTools";
import { ChatView } from "./ChatView";
import {
  ComputerHeadButton,
  ComputerNote,
  ComputerPanel,
  useComputers,
} from "./Computer";
import {
  findKeys,
  focusScreen,
  Palette,
  revealSection,
  usePaletteShortcut,
} from "./Palette";
import type { PaletteTarget } from "./palette-items";
import {
  keepSettingsPage,
  lastSettingsPage,
  SettingsHome,
  settingsKeys,
  useSettingsShortcut,
} from "./Settings";
import { Sidebar } from "./Sidebar";
import {
  FIRST_SETTINGS_PAGE,
  type SettingsPageId,
  type SettingsSectionId,
  sectionStandsAlone,
  sectionTitle,
  settingsRoute,
} from "./settings-sections";
import { UpdateNotice } from "./UpdateNotice";
import { ErrorLine, message as errorText, Nova } from "./ui";
import { Welcome } from "./Welcome";

type View =
  | { name: "chat" }
  | { name: "assistant"; id?: string }
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
   * Whether each assistant's computer panel is open. It opens only when the
   * person asks: the thumbnail in the chat's head shows the computer at work.
   */
  const [computerOpen, setComputerOpen] = useState<Record<string, boolean>>({});
  /** True when the open panel was asked for with a click, so it slides in. */
  const [computerSlide, setComputerSlide] = useState(false);
  const computers = useComputers();
  const [error, setError] = useState("");
  /** Find anything (Ctrl or Cmd+K), and where its last pick leads. */
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<FoundMessage | undefined>(undefined);
  /** The Settings page that is open, or that Settings opens on next. */
  const [settingsPage, setSettingsPage] = useState<SettingsPageId>(
    () => lastSettingsPage() ?? FIRST_SETTINGS_PAGE,
  );
  /**
   * Where the focus goes once a way into Settings has shown its page: the
   * page's heading, or a section's. A new object each time, so opening the
   * same place again still moves the focus there.
   */
  const [reveal, setReveal] = useState<{
    section?: SettingsSectionId;
  } | null>(null);
  const mac = state?.platform === "darwin";
  const toggleFind = useCallback(() => setFinding((open) => !open), []);
  usePaletteShortcut(state?.settings.onboarded === true, mac, toggleFind);

  /**
   * Opens Settings from anywhere: on a page, at a section, or where it was
   * left. The focus lands on the page's heading, or the section's, so a
   * screen reader starts there.
   */
  const openSettings = useCallback(
    (to: { page?: SettingsPageId; section?: SettingsSectionId } = {}) => {
      setSettingsPage((last) => {
        const route = settingsRoute(to, last);
        keepSettingsPage(route.page);
        return route.page;
      });
      setView({ name: "settings" });
      setReveal(to.section ? { section: to.section } : {});
    },
    [],
  );
  useSettingsShortcut(
    state?.settings.onboarded === true,
    mac,
    useCallback(() => openSettings(), [openSettings]),
  );

  // Once the page is shown, the focus goes where the way in asked.
  useEffect(() => {
    if (view.name !== "settings" || !reveal) return;
    const { section } = reveal;
    setReveal(null);
    afterPaint(() => {
      if (section && !sectionStandsAlone(section))
        revealSection(sectionTitle(section));
      else focusScreen();
    });
  }, [view.name, reveal]);

  // A button that opens another screen from inside the old one (Customize,
  // Models in the chat header) is gone with it, and the focus would fall to
  // the top of the page. It lands on the new screen's heading instead, or on
  // the message box when the chat comes back.
  useEffect(() => {
    afterPaint(() => {
      if (!focusLost()) return;
      if (view.name === "chat") document.getElementById("message-box")?.focus();
      else focusScreen();
    });
  }, [view.name]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** The assistants' names, for what is told to a screen reader. */
  const names = useRef(new Map<string, string>());
  useShortcutsKey(
    state?.settings.onboarded === true,
    useCallback(() => setShowShortcuts(true), []),
  );

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState();
      document.documentElement.dataset.platform = next.platform;
      document.documentElement.dataset.textSize = next.settings.textSize;
      applyAccessibility(next.settings.accessibility);
      names.current = new Map(next.assistants.map((a) => [a.id, a.name]));
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
    const nameOf = (id: string) => names.current.get(id) ?? "Your assistant";
    const offDelta = api.onDelta(({ assistantId, text }) => {
      setStreams((s) => ({
        ...s,
        [assistantId]: (s[assistantId] ?? "") + text,
      }));
    });
    const offActivity = api.onActivity(({ assistantId, label }) => {
      setActivity((a) => ({ ...a, [assistantId]: label }));
    });
    const offApproval = api.onApproval(({ assistantId, card }) => {
      if (card)
        announce(
          `${nameOf(assistantId)} waits for your Approve: ${card.title}`,
        );
      setApprovals((a) =>
        card ? { ...a, [assistantId]: card } : without(a, assistantId),
      );
    });
    const offDone = api.onDone(({ assistantId, message, request }) => {
      const name = nameOf(assistantId);
      announce(
        message.failed
          ? `${name} could not answer. ${message.text}`
          : message.check === "update"
            ? `${name} has an update from a check.`
            : `${name} finished its answer.`,
      );
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
    // A check found a version (read the state again, so the notice shows), or
    // the person clicked the system notice: Settings opens on Updates.
    const offUpdate = api.onUpdateNews(({ open }) => {
      void refresh();
      if (open) openSettings({ section: "updates" });
    });
    return () => {
      offDelta();
      offActivity();
      offApproval();
      offDone();
      offUpdate();
    };
  }, [refresh, openSettings]);

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
        <SkipLinks messageBox={false} />
        <Welcome
          keychain={state.keychain}
          checkUpdates={state.settings.checkUpdates}
          onCheckUpdates={(on) =>
            void act(async () => {
              await api.setSettings({ checkUpdates: on });
              await refresh();
            })
          }
          onDone={() => void finishWelcome()}
          onCloud={() => void act(() => api.openCloud("home"))}
        />
        <ErrorLine>{error}</ErrorLine>
      </>
    );
  }

  const newVersion = availableUpdate(state.settings, state.version);
  const assistant = state.assistants.find((a) => a.id === selected);
  // Its computer shows in the chat once Docker runs here; until the
  // computers are set up, the panel is where that is done.
  const computerShown =
    assistant?.computer !== undefined &&
    (computers.readiness === "ready" || computers.readiness === "setup");
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

  /** The model that answers and its preset, for the chat's context meter. */
  function modelOf(a: Assistant): { model?: string; preset?: string } {
    const source = state?.sources.find(
      (s) => s.id === (a.sourceId ?? state.settings.defaultSourceId),
    );
    return source
      ? { model: a.model ?? source.model, preset: source.preset }
      : {};
  }

  async function send(a: Assistant, text: string, attachmentIds: string[]) {
    const sent = await api.send(a.id, text, attachmentIds);
    setChats((c) => ({ ...c, [a.id]: [...(c[a.id] ?? []), sent] }));
    setStreams((s) => ({ ...s, [a.id]: s[a.id] ?? "" }));
  }

  async function decide(card: ApprovalCard, decision: Decision) {
    await api.decide(card.assistantId, card.id, decision);
    // "Always allow" saved a site, so the assistant's own list changed.
    if (decision === "always") await refresh();
  }

  /** Where a pick in Find anything leads. */
  function go(target: PaletteTarget) {
    setFinding(false);
    switch (target.kind) {
      case "assistant":
        setSelected(target.id);
        setView({ name: "chat" });
        afterPaint(() => document.getElementById("message-box")?.focus());
        return;
      case "message":
        setSelected(target.assistantId);
        setView({ name: "chat" });
        setFound((last) => ({
          assistantId: target.assistantId,
          messageId: target.messageId,
          nonce: (last?.nonce ?? 0) + 1,
        }));
        // The chat puts the focus on the message. If it cannot be shown, the
        // focus is not left on the page: it goes to the message box.
        refocusIfLost(() => document.getElementById("message-box"));
        return;
      case "settings":
        openSettings({
          ...(target.page ? { page: target.page } : {}),
          ...(target.section ? { section: target.section } : {}),
        });
        return;
      case "new":
        setView({ name: "assistant" });
        afterPaint(focusScreen);
        return;
      case "import":
        void importFile();
        return;
      case "shortcuts":
        setShowShortcuts(true);
        return;
      case "save-chat":
        void act(() => api.exportChat(target.assistantId));
        return;
    }
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

  const where =
    view.name === "chat"
      ? assistant
        ? `Chat with ${assistant.name}`
        : "Your assistants"
      : {
          assistant: editing ? `Change ${editing.name}` : "New assistant",
          settings: "Settings",
        }[view.name];

  return (
    <div className="app">
      <SkipLinks messageBox={view.name === "chat" && Boolean(assistant)} />
      <ShortcutsDialog
        open={showShortcuts}
        mac={mac}
        sendWith={state.settings.sendWith}
        onClose={() => setShowShortcuts(false)}
      />
      <Sidebar
        assistants={state.assistants}
        selected={view.name === "chat" ? selected : null}
        busy={new Set(Object.keys(streams))}
        waiting={new Set(Object.keys(approvals))}
        unread={new Set(unreadMain ? [unreadMain] : [])}
        showCloudCard={!state.settings.hideCloudCard}
        settingsOpen={view.name === "settings"}
        notice={
          newVersion ? (
            <UpdateNotice
              version={newVersion}
              canDownload={
                downloadFile(newVersion, {
                  platform: state.platform,
                  arch: state.arch,
                }) !== null
              }
              onDownload={() => void act(() => api.openLink("download"))}
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
        onSettings={() => openSettings()}
        settingsKeys={settingsKeys(mac)}
        onCloud={() => void act(() => api.openCloud("home"))}
        onFind={() => setFinding(true)}
        findKeys={findKeys(mac)}
        onHideCloudCard={() =>
          void act(async () => {
            await api.setSettings({ hideCloudCard: true });
            await refresh();
          })
        }
      />
      <main className="main" id="main" tabIndex={-1} aria-label={where}>
        {error ? (
          <div style={{ padding: "0.75rem 1.25rem 0" }}>
            <ErrorLine>{error}</ErrorLine>
          </div>
        ) : null}
        {view.name === "settings" ? (
          <SettingsHome
            state={state}
            page={settingsPage}
            onPage={(page, how) => {
              setSettingsPage(page);
              keepSettingsPage(page);
              // A button on the page that led away is gone with it; the
              // focus goes to the new page's heading. From the list, it
              // stays on the list.
              if (how === "link") afterPaint(focusScreen);
            }}
            onChanged={refresh}
            onBack={() => setView({ name: "chat" })}
            onChatsDeleted={() => setChats({})}
            onShortcuts={() => setShowShortcuts(true)}
            onCloud={() => void act(() => api.openCloud("home"))}
          />
        ) : view.name === "assistant" ? (
          <AssistantForm
            key={view.id ?? "new"}
            assistant={editing}
            sources={state.sources}
            connections={state.connections}
            mailAccounts={state.mailAccounts}
            assistants={state.assistants}
            ownSkills={state.settings.ownSkills}
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
                // One chat's open question or dismissed offer never shows up
                // in the next: each assistant gets a fresh chat view.
                key={assistant.id}
                headExtra={
                  computerShown ? (
                    <ComputerHeadButton
                      assistant={assistant}
                      on={computers.running.has(assistant.id)}
                      open={computerOpen[assistant.id] === true}
                      onToggle={(pointer) => {
                        setComputerSlide(pointer);
                        setComputerOpen((open) => ({
                          ...open,
                          [assistant.id]: open[assistant.id] !== true,
                        }));
                      }}
                    />
                  ) : null
                }
                emptyExtra={
                  assistant.computer ? (
                    <ComputerNote
                      readiness={computers.readiness}
                      onSetUp={() => {
                        setComputerSlide(false);
                        setComputerOpen((open) => ({
                          ...open,
                          [assistant.id]: true,
                        }));
                      }}
                    />
                  ) : null
                }
                assistant={assistant}
                modelLine={modelLine(assistant)}
                messages={chats[assistant.id] ?? []}
                streaming={streams[assistant.id]}
                activity={activity[assistant.id]}
                approval={approvals[assistant.id]}
                onSend={(text, ids) => send(assistant, text, ids)}
                onStop={() => void api.stop(assistant.id)}
                onDecide={decide}
                onCustomize={() =>
                  setView({ name: "assistant", id: assistant.id })
                }
                onModels={() => openSettings({ page: "models" })}
                sendWith={state.settings.sendWith}
                mac={mac}
                readRate={
                  cleanAccessibility(state.settings.accessibility).readRate
                }
                onSaveChat={() => api.exportChat(assistant.id)}
                onCopy={(messageId) => api.copyMessage(assistant.id, messageId)}
                found={found?.assistantId === assistant.id ? found : undefined}
                {...modelOf(assistant)}
                onChatChanged={(next) => {
                  setChats((c) => ({ ...c, [assistant.id]: next }));
                  void refresh();
                }}
              />
            </div>
            {computerShown && computerOpen[assistant.id] === true ? (
              <ComputerPanel
                assistant={assistant}
                assistants={state.assistants}
                slide={computerSlide}
                onSetUp={() => void computers.check()}
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
      {finding ? (
        <Palette
          state={state}
          savableId={
            view.name === "chat" &&
            assistant &&
            (chats[assistant.id]?.length ?? 0) > 0
              ? assistant.id
              : null
          }
          mac={mac}
          onGo={go}
          onClose={() => setFinding(false)}
        />
      ) : null}
    </div>
  );
}
