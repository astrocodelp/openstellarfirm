import {
  checkOwnSkillInput,
  newOwnSkillId,
  type OwnSkill,
} from "../../shared/own-skills";
import {
  callsFor,
  MAX_FRAMES,
  MAX_RECORDING_MS,
  type RecordFrame,
  type RecordStatus,
  SAMPLE_MS,
} from "../../shared/recording";
import type { AppState, OpenApi } from "../../shared/types";

type RecordApi = Pick<
  OpenApi,
  | "recordSources"
  | "recordStart"
  | "recordStop"
  | "recordStatus"
  | "recordAddFrame"
  | "recordRemoveFrame"
  | "recordClear"
  | "recordPlan"
  | "recordDraft"
  | "recordCancel"
  | "onRecord"
  | "saveOwnSkill"
  | "removeOwnSkill"
>;

/** A made-up picture for the browser preview: a colour and a number. */
function stand(n: number): string {
  const hue = (n * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="hsl(${hue} 40% 30%)"/><text x="80" y="60" font-size="28" text-anchor="middle" fill="white" font-family="sans-serif">${n}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Record how you work, in the browser preview (`pnpm dev:ui`). It captures
 * nothing and calls no model: a live recording adds made-up pictures, and a
 * draft is a fixed example. A video picked here is sampled for real.
 */
export function recordPreview(state: AppState): RecordApi {
  const listeners = new Set<(status: RecordStatus) => void>();
  let status: RecordStatus = {
    recording: false,
    elapsedMs: 0,
    maxMs: MAX_RECORDING_MS,
    frames: [],
    skipped: 0,
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let count = 0;
  const emit = () => {
    for (const listener of listeners) listener(structuredClone(status));
    return structuredClone(status);
  };
  const stop = (reason: RecordStatus["stopped"]) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    status = {
      ...status,
      recording: false,
      ...(reason ? { stopped: reason } : {}),
    };
    emit();
  };
  const add = (frame: RecordFrame) => {
    status = { ...status, frames: [...status.frames, frame] };
    if (status.frames.length >= MAX_FRAMES) stop("frames");
  };
  return {
    recordSources: async () => [
      {
        id: "screen:1",
        name: "Entire screen",
        kind: "screen",
        thumb: stand(1),
        private: false,
      },
      {
        id: "window:2",
        name: "Notes",
        kind: "window",
        thumb: stand(2),
        private: false,
      },
      {
        id: "window:3",
        name: "1Password",
        kind: "window",
        thumb: "",
        private: true,
      },
    ],
    recordStart: async (sourceId) => {
      count = 0;
      status = {
        recording: true,
        sourceName: sourceId === "screen:1" ? "Entire screen" : "Notes",
        kind: sourceId.startsWith("screen") ? "screen" : "window",
        elapsedMs: 0,
        maxMs: MAX_RECORDING_MS,
        frames: [],
        skipped: 0,
      };
      timer = setInterval(() => {
        status = { ...status, elapsedMs: status.elapsedMs + SAMPLE_MS };
        count += 1;
        if (count % 2 === 1)
          add({
            id: crypto.randomUUID(),
            atMs: status.elapsedMs,
            thumb: stand(count),
          });
        if (status.elapsedMs >= MAX_RECORDING_MS) stop("time");
        else emit();
      }, SAMPLE_MS);
      return emit();
    },
    recordStop: async () => {
      stop("person");
      return structuredClone(status);
    },
    recordStatus: async () => structuredClone(status),
    recordAddFrame: async (jpeg, atMs) => {
      if (status.recording && status.kind !== "video")
        throw new Error("Stop the recording first.");
      if (status.kind !== "video")
        status = {
          recording: false,
          kind: "video",
          sourceName: "A video",
          elapsedMs: 0,
          maxMs: MAX_RECORDING_MS,
          frames: [],
          skipped: 0,
        };
      if (status.frames.length >= MAX_FRAMES)
        throw new Error(`A recording keeps at most ${MAX_FRAMES} pictures.`);
      add({
        id: crypto.randomUUID(),
        atMs,
        thumb: `data:image/jpeg;base64,${jpeg}`,
      });
      status = { ...status, elapsedMs: Math.max(status.elapsedMs, atMs) };
      return emit();
    },
    recordRemoveFrame: async (frameId) => {
      status = {
        ...status,
        frames: status.frames.filter((f) => f.id !== frameId),
      };
      return emit();
    },
    recordClear: async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      status = {
        recording: false,
        elapsedMs: 0,
        maxMs: MAX_RECORDING_MS,
        frames: [],
        skipped: 0,
      };
      return emit();
    },
    recordPlan: async (_assistantId, sourceId) => {
      const source =
        state.sources.find((s) => s.id === sourceId) ?? state.sources[0];
      return {
        pictures: status.frames.length,
        calls: callsFor(status.frames.length),
        model: source ? `${source.name} · ${source.model}` : "No model",
        where: "on this computer",
        local: true,
        sourceId: source?.id ?? "",
      };
    },
    recordDraft: async () => {
      const total = callsFor(status.frames.length);
      for (let done = 0; done < total; done += 1) {
        status = { ...status, drafting: { done, total } };
        emit();
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const { drafting: _gone, ...rest } = status;
      status = rest;
      emit();
      return {
        name: "File a weekly expense report",
        description: "Fill the expense sheet from receipts, then file it.",
        lines: [
          "Open the expense sheet for this week and add one row for each receipt.",
          "Use the date, shop and total from the receipt, and pick the category.",
          "Check the sum against the receipts before you file it.",
        ],
      };
    },
    recordCancel: async () => {},
    onRecord: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveOwnSkill: async (input) => {
      const checked = checkOwnSkillInput(input);
      const list = state.settings.ownSkills ?? [];
      const before = list.find((s) => s.id === input.id);
      const saved: OwnSkill = {
        ...checked,
        id: before?.id ?? newOwnSkillId(checked.name, crypto.randomUUID()),
        source: before?.source ?? input.source ?? "recording",
        createdAt: before?.createdAt ?? new Date().toISOString(),
        ...(before ? { updatedAt: new Date().toISOString() } : {}),
      };
      state.settings.ownSkills = before
        ? list.map((s) => (s.id === saved.id ? saved : s))
        : [...list, saved];
      return saved;
    },
    removeOwnSkill: async (skillId) => {
      state.settings.ownSkills = (state.settings.ownSkills ?? []).filter(
        (s) => s.id !== skillId,
      );
      state.assistants = state.assistants.map((a) => ({
        ...a,
        skills: a.skills.filter((s) => s !== skillId),
      }));
    },
  };
}
