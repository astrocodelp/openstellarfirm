import { randomUUID } from "node:crypto";
import { app, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { OwnSkillInput } from "../../shared/own-skills";
import { callsFor, MAX_NOTES, type RecordPlan } from "../../shared/recording";
import { IPC } from "../../shared/types";
import { ModelError, type TurnEvent, type WireMessage } from "../models";
import type { Store } from "../store";
import { grabSource, listSources, pickSource, thumbOfJpeg } from "./capture";
import { draftSkill } from "./draft";
import { RecordingSession } from "./session";

/**
 * Record how you work, wired to the page. Every value from the page is
 * checked here: a source id is looked up again among the real ones, a picture
 * is checked to be a JPEG within the limits, and notes are cut to size.
 */

type Handle = <T>(
  channel: string,
  run: (event: IpcMainInvokeEvent, ...args: never[]) => T | Promise<T>,
) => void;

/** The model a draft goes to, as the person is shown it before anything is sent. */
export interface DraftModel {
  plan: Omit<RecordPlan, "pictures" | "calls">;
  turn(messages: WireMessage[], signal: AbortSignal): AsyncGenerator<TurnEvent>;
}

export interface RecordingHost {
  handle: Handle;
  window: BrowserWindow;
  store: Store;
  /** The assistant's own model, or another saved source the person picked. */
  model(assistantId: string, sourceId?: string): Promise<DraftModel>;
}

const TITLE = "OpenStellarFirm";

function idOf(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value || value.length > max)
    throw new Error("That is not allowed.");
  return value;
}

function optionalId(value: unknown): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : idOf(value, 80);
}

/** A clear sign that it records, outside the app's page too. */
function showRecording(window: BrowserWindow, on: boolean, share: number) {
  if (window.isDestroyed()) return;
  window.setTitle(on ? `● Recording · ${TITLE}` : TITLE);
  window.setProgressBar(on ? Math.min(1, Math.max(0, share)) : -1);
  if (process.platform === "darwin") app.dock?.setBadge(on ? "REC" : "");
}

export function registerRecording(host: RecordingHost): RecordingSession {
  const { handle, window, store } = host;
  let draft: AbortController | undefined;
  let wasRecording = false;
  const session = new RecordingSession({
    grab: grabSource,
    ownInFront: () =>
      !window.isDestroyed() &&
      window.isFocused() &&
      window.isVisible() &&
      !window.isMinimized(),
    thumbOf: thumbOfJpeg,
    now: () => Date.now(),
    every: (ms, run) => {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    id: () => randomUUID(),
    onChange: (status) => {
      if (status.recording || wasRecording)
        showRecording(
          window,
          status.recording,
          status.elapsedMs / status.maxMs,
        );
      wasRecording = status.recording;
      if (!window.isDestroyed()) window.webContents.send(IPC.record, status);
    },
  });

  handle(IPC.recordSources, () => listSources(window));
  handle(IPC.recordStart, async (_e, sourceId: unknown) =>
    session.start(await pickSource(window, idOf(sourceId))),
  );
  handle(IPC.recordStop, () => session.stop("person"));
  handle(IPC.recordStatus, () => session.status());
  handle(IPC.recordAddFrame, (_e, jpeg: unknown, atMs: unknown) =>
    session.addVideoFrame(jpeg, atMs),
  );
  handle(IPC.recordRemoveFrame, (_e, frameId: unknown) =>
    session.removeFrame(idOf(frameId, 80)),
  );
  handle(IPC.recordClear, () => session.clear());
  handle(
    IPC.recordPlan,
    async (
      _e,
      assistantId: unknown,
      sourceId: unknown,
    ): Promise<RecordPlan> => {
      const model = await host.model(idOf(assistantId), optionalId(sourceId));
      const pictures = session.pictures().length;
      return { ...model.plan, pictures, calls: callsFor(pictures) };
    },
  );
  handle(
    IPC.recordDraft,
    async (_e, assistantId: unknown, notes: unknown, sourceId: unknown) => {
      if (draft) throw new Error("A draft is being written already.");
      if (session.recording) throw new Error("Stop the recording first.");
      if (typeof notes !== "string" || notes.length > MAX_NOTES * 4)
        throw new Error("That is not allowed.");
      const model = await host.model(idOf(assistantId), optionalId(sourceId));
      const controller = new AbortController();
      draft = controller;
      try {
        return await draftSkill(session.pictures(), notes.slice(0, MAX_NOTES), {
          turn: (messages) => model.turn(messages, controller.signal),
          signal: controller.signal,
          onProgress: (done, total) => session.setDrafting({ done, total }),
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ModelError("Stopped.");
        throw error;
      } finally {
        draft = undefined;
        session.setDrafting(undefined);
      }
    },
  );
  handle(IPC.recordCancel, () => {
    draft?.abort();
  });
  handle(IPC.saveOwnSkill, (_e, input: OwnSkillInput) =>
    store.saveOwnSkill(input),
  );
  handle(IPC.removeOwnSkill, (_e, id: unknown) => {
    store.removeOwnSkill(idOf(id, 60));
  });
  return session;
}
