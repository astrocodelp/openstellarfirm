import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { OwnSkill, OwnSkillDraft } from "../../shared/own-skills";
import {
  callsFor,
  clockOf,
  MAX_FRAMES,
  MAX_NOTES,
  NO_PICTURES_LINE,
  PICTURES_A_CALL,
  type RecordFrame,
  type RecordPlan,
  type RecordSource,
  type RecordStatus,
} from "../../shared/recording";
import { MAX_SKILLS } from "../../shared/skill-library";
import type { Assistant, ModelSource } from "../../shared/types";
import { api } from "./bridge";
import { Modal, OwnSkillEditor } from "./OwnSkills";
import {
  ErrorLine,
  message as errorText,
  Icon,
  InlineConfirm,
  OkLine,
} from "./ui";
import { sampleVideo, VideoError } from "./video-frames";
import "./record.css";

/**
 * Record how you work. The person shows a task once (their screen, one
 * window, or a video they already have), keeps the pictures they want, and the
 * assistant's own model drafts a skill from them. The person reads and edits
 * the draft, and only their Save keeps it. The page captures nothing itself:
 * the main process does, after the person picks what to record.
 */

type Step =
  | "start"
  | "pick"
  | "recording"
  | "video"
  | "review"
  | "drafting"
  | "edit"
  | "saved";

const EMPTY: RecordStatus = {
  recording: false,
  elapsedMs: 0,
  maxMs: 10 * 60 * 1000,
  frames: [],
  skipped: 0,
};

/** Focus moves to a step's heading when it appears, once the dialog is open. */
function focusHeading(node: HTMLHeadingElement | null) {
  if (node?.closest("dialog[open]")) node.focus({ preventScroll: true });
}

const STOPPED: Record<NonNullable<RecordStatus["stopped"]>, string> = {
  person: "",
  time: "It stopped at ten minutes, the longest a recording runs.",
  frames: `It stopped at ${MAX_FRAMES} pictures, the most a recording keeps.`,
  gone: "It stopped because the screen or window was no longer there.",
  private: "It stopped because something private was in front.",
};

function pictures(n: number): string {
  return n === 1 ? "1 picture" : `${n} pictures`;
}

export function RecordSkill({
  assistant,
  sources,
  onSaved,
}: {
  assistant: Assistant;
  sources: ModelSource[];
  /** A skill was saved; `ticked` when it was ticked for this assistant too. */
  onSaved(skill: OwnSkill, ticked: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card pad stack-tight" aria-labelledby="record-title">
      <h2 className="section-title" id="record-title">
        Record how you work
      </h2>
      <p className="faint">
        Show it a task once. Record your screen or one window, or pick a video
        you have. Its model drafts a skill from the pictures; you read and edit
        it, and nothing is kept until you save.
      </p>
      <div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Record how you work
        </button>
      </div>
      {open ? (
        <RecordDialog
          assistant={assistant}
          sources={sources}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function RecordDialog({
  assistant,
  sources,
  onSaved,
  onClose,
}: {
  assistant: Assistant;
  sources: ModelSource[];
  onSaved(skill: OwnSkill, ticked: boolean): void;
  onClose(): void;
}) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("start");
  const [status, setStatus] = useState<RecordStatus>(EMPTY);
  const [list, setList] = useState<RecordSource[] | null>(null);
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<RecordPlan>();
  const [pickedSource, setPickedSource] = useState<string>();
  const [noPictures, setNoPictures] = useState(false);
  const [draft, setDraft] = useState<OwnSkillDraft>();
  const [tick, setTick] = useState(true);
  const [saved, setSaved] = useState<OwnSkill>();
  const [savedTicked, setSavedTicked] = useState(false);
  const [videoShare, setVideoShare] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const video = useRef<AbortController | null>(null);

  // What the main process holds right now, and every change to it.
  useEffect(() => {
    let live = true;
    void api.recordStatus().then((now) => {
      if (!live) return;
      setStatus(now);
      if (now.recording) setStep("recording");
      else if (now.frames.length > 0) setStep("review");
    });
    const off = api.onRecord((next) => {
      setStatus(next);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  // A recording that stops by itself (time, the picture limit) goes to review.
  useEffect(() => {
    if (step === "recording" && !status.recording) setStep("review");
  }, [step, status.recording]);

  const frames = status.frames;
  const loadPlan = useCallback(async () => {
    try {
      setPlan(await api.recordPlan(assistant.id, pickedSource));
    } catch (e) {
      setError(errorText(e));
    }
  }, [assistant.id, pickedSource]);

  useEffect(() => {
    if (step === "review") void loadPlan();
  }, [step, loadPlan]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function showSources() {
    void run(async () => {
      setList(null);
      setStep("pick");
      setList(await api.recordSources());
    });
  }

  function start(source: RecordSource) {
    void run(async () => {
      setStatus(await api.recordStart(source.id));
      setStep("recording");
    });
  }

  function stop() {
    void run(async () => {
      setStatus(await api.recordStop());
      setStep("review");
    });
  }

  async function pickVideo(file: File) {
    setError("");
    const controller = new AbortController();
    video.current = controller;
    setVideoShare(0);
    setStep("video");
    try {
      await api.recordClear();
      const result = await sampleVideo(file, {
        signal: controller.signal,
        onProgress: setVideoShare,
        send: async (jpeg, atMs) => {
          setStatus(await api.recordAddFrame(jpeg, atMs));
        },
      });
      if (result.kept === 0) {
        setError("Nothing changed in that video, so no picture was kept.");
        setStep("start");
        return;
      }
      if (result.full)
        setError(
          `It kept ${MAX_FRAMES} pictures, the most a recording keeps, and stopped looking.`,
        );
      setStep("review");
    } catch (e) {
      const stopped = controller.signal.aborted;
      if (!stopped)
        setError(e instanceof VideoError ? e.message : errorText(e));
      const now = await api.recordStatus();
      setStatus(now);
      setStep(now.frames.length > 0 ? "review" : "start");
    } finally {
      video.current = null;
    }
  }

  function writeDraft() {
    setError("");
    setNoPictures(false);
    setStep("drafting");
    void (async () => {
      try {
        const next = await api.recordDraft(assistant.id, notes, pickedSource);
        setDraft(next);
        setStep("edit");
      } catch (e) {
        const line = errorText(e);
        if (line === NO_PICTURES_LINE) setNoPictures(true);
        if (line !== "Stopped.") setError(line);
        setStep("review");
      }
    })();
  }

  async function save(next: OwnSkillDraft) {
    setBusy(true);
    try {
      const skill = await api.saveOwnSkill({ ...next, source: "recording" });
      // The tick is kept at once, on the assistant as it is saved now.
      let ticked = false;
      if (
        tick &&
        !assistant.skills.includes(skill.id) &&
        assistant.skills.length < MAX_SKILLS
      ) {
        await api.saveAssistant({
          id: assistant.id,
          name: assistant.name,
          group: assistant.group,
          pet: assistant.pet,
          color: assistant.color,
          brief: assistant.brief,
          skills: [...assistant.skills, skill.id],
          ...(assistant.sourceId ? { sourceId: assistant.sourceId } : {}),
          ...(assistant.model ? { model: assistant.model } : {}),
        });
        ticked = true;
      }
      // The pictures are not needed any more: they are dropped now.
      await api.recordClear();
      setSaved(skill);
      setSavedTicked(ticked);
      onSaved(skill, ticked);
      setStep("saved");
    } finally {
      setBusy(false);
    }
  }

  /** Closing forgets the pictures; with some kept, it asks first. */
  function requestClose() {
    // Escape inside the question closes the question, not the dialog.
    if (leaving) {
      setLeaving(false);
      return;
    }
    if (status.recording || frames.length > 0 || step === "drafting") {
      setLeaving(true);
      return;
    }
    onClose();
  }

  async function closeAndForget() {
    video.current?.abort();
    try {
      if (step === "drafting") await api.recordCancel();
      await api.recordClear();
    } catch {
      // Closing never fails: whatever is left goes when the app quits.
    }
    onClose();
  }

  const title: Record<Step, string> = {
    start: "Record how you work",
    pick: "What should it record?",
    recording: "Recording",
    video: "Looking through your video",
    review: "Keep the pictures you want",
    drafting: "Drafting a skill",
    edit: "Read and edit the skill",
    saved: "Saved",
  };
  const otherSources = sources.filter((s) => s.id !== plan?.sourceId);
  /** Calls that look at pictures; one more writes the skill. */
  const calls = callsFor(frames.length) - 1;

  return (
    <Modal
      labelledBy={titleId}
      onClose={requestClose}
      className="record-dialog"
    >
      <div className="modal-body stack">
        <div className="modal-head">
          <h2
            // A new heading for each step, so it takes focus and is announced.
            key={step}
            className="section-title"
            id={titleId}
            ref={focusHeading}
            tabIndex={-1}
          >
            {title[step]}
          </h2>
          <button
            type="button"
            className="close-btn"
            aria-label="Close"
            onClick={requestClose}
          >
            <Icon name="close" />
          </button>
        </div>

        {leaving ? (
          <InlineConfirm
            className="card stack pad"
            label="Close and forget"
            onClose={() => setLeaving(false)}
          >
            <p>
              Close and forget{" "}
              {frames.length > 0
                ? `the ${pictures(frames.length)}`
                : "this recording"}
              ? They were only held in memory, so they cannot be brought back.
            </p>
            <div className="wrap">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void closeAndForget()}
              >
                Close and forget
              </button>
              <button
                data-autofocus
                type="button"
                className="btn"
                onClick={() => setLeaving(false)}
              >
                Keep going
              </button>
            </div>
          </InlineConfirm>
        ) : null}

        {step === "start" ? (
          <>
            <ul className="record-notes">
              <li>
                Close password managers, keys and private messages first.
                Everything on what you record can go to the model.
              </li>
              <li>
                A picture is taken every two seconds, and kept only when the
                screen changed. No video is saved. Up to ten minutes and{" "}
                {MAX_FRAMES} pictures.
              </li>
              <li>
                No picture of the whole screen is kept while OpenStellarFirm is
                in front, and none of a window whose title reads like a password
                manager. It cannot spot anything else that is private.
              </li>
            </ul>
            <div className="record-options">
              <button
                type="button"
                className="record-option"
                disabled={busy}
                onClick={showSources}
              >
                <span className="record-option-title">Record your screen</span>
                <span className="faint">
                  The whole screen or one window. You pick which.
                </span>
              </button>
              <button
                type="button"
                className="record-option"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <span className="record-option-title">
                  Use a video you have
                </span>
                <span className="faint">
                  A screen recording on this computer. It is looked through here
                  and not copied.
                </span>
              </button>
              <input
                ref={fileRef}
                className="visually-hidden"
                type="file"
                accept="video/*"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void pickVideo(file);
                }}
              />
            </div>
          </>
        ) : null}

        {step === "pick" ? (
          <>
            <p className="faint">
              Picking one starts the recording. Only what you pick is recorded,
              and OpenStellarFirm itself is never offered.
            </p>
            {list === null ? (
              <p className="faint" role="status">
                Finding your screens and windows…
              </p>
            ) : list.length === 0 ? (
              <p className="faint">
                No screen or window was offered. On macOS, allow OpenStellarFirm
                in System Settings, Privacy & Security, Screen Recording, then
                try again.
              </p>
            ) : (
              <ul className="record-sources">
                {list.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      className="record-source"
                      disabled={busy || source.private}
                      onClick={() => start(source)}
                    >
                      <span className="record-source-thumb" aria-hidden="true">
                        {source.thumb ? (
                          <img src={source.thumb} alt="" />
                        ) : null}
                      </span>
                      <span className="record-source-name">{source.name}</span>
                      <span className="faint">
                        {source.private
                          ? "Not offered: reads like a password manager"
                          : source.kind === "screen"
                            ? "Whole screen"
                            : "Window"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => setStep("start")}
              >
                Back
              </button>
            </div>
          </>
        ) : null}

        {step === "recording" ? (
          <div className="stack">
            <p className="record-live" role="status" aria-live="polite">
              <span className="record-dot pulse" aria-hidden="true" />
              <span>
                Recording {status.sourceName ?? "your screen"} ·{" "}
                {pictures(frames.length)} kept
              </span>
            </p>
            <p className="record-clock record-num" aria-hidden="true">
              {clockOf(status.elapsedMs)} of {clockOf(status.maxMs)}
            </p>
            <p className="faint">
              Do the task the way you always do. You can switch to other apps;
              the window title and the app's icon show it is recording. Come
              back here to stop.
            </p>
            {status.skipped > 0 ? (
              <p className="faint">
                {status.skipped === 1
                  ? "1 look was not kept"
                  : `${status.skipped} looks were not kept`}{" "}
                because OpenStellarFirm or a private window was in front.
              </p>
            ) : null}
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={stop}
              >
                <Icon name="stop" />
                Stop
              </button>
            </div>
          </div>
        ) : null}

        {step === "video" ? (
          <div className="stack">
            <p role="status" className="record-num">
              Looking through the video: {Math.round(videoShare * 100)}% ·{" "}
              {pictures(frames.length)} kept
            </p>
            <progress className="record-progress" max={1} value={videoShare}>
              {Math.round(videoShare * 100)}%
            </progress>
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => video.current?.abort()}
              >
                Stop
              </button>
            </div>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="stack">
            {status.stopped && STOPPED[status.stopped] ? (
              <p className="faint">{STOPPED[status.stopped]}</p>
            ) : null}
            {frames.length === 0 ? (
              <p className="faint">
                No picture is kept. Record again, or pick a video.
              </p>
            ) : (
              <FrameStrip
                frames={frames}
                onRemove={(id) =>
                  void run(async () => {
                    setStatus(await api.recordRemoveFrame(id));
                  })
                }
              />
            )}
            <label className="field">
              <span className="field-label">What were you doing?</span>
              <span className="faint">
                A few words help the model, such as “filing this week's
                expenses”. Optional.
              </span>
              <textarea
                className="input"
                rows={3}
                value={notes}
                maxLength={MAX_NOTES}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            {plan && frames.length > 0 ? (
              <div className="card pad stack-tight record-plan">
                <p>
                  {pictures(frames.length)} go to <strong>{plan.model}</strong>
                  {plan.local ? ", on this computer" : `, at ${plan.where}`}, in{" "}
                  {calls === 1 ? "1 call" : `${calls} calls`} of up to{" "}
                  {PICTURES_A_CALL} pictures, then one more call with text only
                  to write the skill.
                </p>
                <p className="faint">
                  Whatever was on screen in them goes to that model.
                  {plan.local
                    ? " With a model on this computer, it stays here."
                    : " Remove any picture that shows something private."}
                </p>
              </div>
            ) : null}

            {noPictures && otherSources.length > 0 ? (
              <label className="field">
                <span className="field-label">Try another model</span>
                <select
                  className="input"
                  value={pickedSource ?? ""}
                  onChange={(event) =>
                    setPickedSource(event.target.value || undefined)
                  }
                >
                  <option value="">This assistant's own model</option>
                  {otherSources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.model}
                    </option>
                  ))}
                </select>
                <span className="faint">
                  Only for this draft. The assistant keeps its own model.
                </span>
              </label>
            ) : null}
            {noPictures && otherSources.length === 0 ? (
              <p className="faint">
                Add a model that reads pictures in Models, then come back.
              </p>
            ) : null}

            <div className="wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || frames.length === 0 || !plan}
                onClick={writeDraft}
              >
                Draft a skill
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setStatus(await api.recordClear());
                    setNoPictures(false);
                    setStep("start");
                  })
                }
              >
                Start over
              </button>
            </div>
          </div>
        ) : null}

        {step === "drafting" ? (
          <div className="stack">
            <p role="status" className="record-num">
              {status.drafting
                ? status.drafting.done < status.drafting.total - 1
                  ? `Looking at the pictures: call ${status.drafting.done + 1} of ${status.drafting.total}`
                  : "Writing the skill"
                : "Starting"}
              …
            </p>
            {status.drafting ? (
              <progress
                className="record-progress"
                max={status.drafting.total}
                value={status.drafting.done}
              />
            ) : null}
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => void api.recordCancel()}
              >
                Stop
              </button>
            </div>
          </div>
        ) : null}

        {step === "edit" && draft ? (
          <>
            <p className="faint">
              A model wrote this from pictures of your screen. Read every line:
              it may have got something wrong. Saving adds it to My skills.
            </p>
            <OwnSkillEditor
              initial={draft}
              submitLabel="Save skill"
              busy={busy}
              cancelLabel="Back to the pictures"
              onCancel={() => setStep("review")}
              onSubmit={save}
            >
              <label className="choice" style={{ alignSelf: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={tick}
                  disabled={assistant.skills.length >= MAX_SKILLS}
                  onChange={(event) => setTick(event.target.checked)}
                />
                <span>Tick it for {assistant.name}</span>
              </label>
              {assistant.skills.length >= MAX_SKILLS ? (
                <p className="faint">
                  {assistant.name} has {MAX_SKILLS} skills already. Untick one
                  to add this.
                </p>
              ) : null}
            </OwnSkillEditor>
          </>
        ) : null}

        {step === "saved" && saved ? (
          <div className="stack">
            <OkLine>
              Saved “{saved.name}” to My skills
              {savedTicked ? ` and ticked it for ${assistant.name}` : ""}
            </OkLine>
            <p className="faint">
              The pictures are gone. You can edit or delete the skill in the
              skills list.
            </p>
            <div>
              <button type="button" className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : null}

        <ErrorLine>{error}</ErrorLine>
      </div>
    </Modal>
  );
}

/**
 * The kept pictures in a row. Each has its own Remove button; the arrow keys
 * move between them and Delete removes the one in focus.
 */
function FrameStrip({
  frames,
  onRemove,
}: {
  frames: RecordFrame[];
  onRemove(id: string): void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const pending = useRef<number | null>(null);

  // After a removal, focus stays on the strip: the next picture, or the last.
  useEffect(() => {
    const index = pending.current;
    if (index === null) return;
    pending.current = null;
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons || buttons.length === 0) return;
    buttons[Math.min(index, frames.length - 1, buttons.length - 1)]?.focus();
  }, [frames]);

  function remove(index: number, id: string) {
    pending.current = index;
    onRemove(id);
  }

  function keys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons) return;
    const go = (to: number) => {
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus();
    };
    if (event.key === "ArrowRight" || event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(buttons.length - 1);
    else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const frame = frames[index];
      if (frame) remove(index, frame.id);
    }
  }

  return (
    <div className="stack-tight">
      <p className="faint" id="record-strip-help">
        {pictures(frames.length)} kept. Remove any you do not want to send. Use
        the arrow keys to move, and Delete to remove one.
      </p>
      <ul
        className="record-strip"
        ref={listRef}
        aria-label="Kept pictures"
        aria-describedby="record-strip-help"
      >
        {frames.map((frame, index) => (
          <li key={frame.id} className="record-frame">
            {frame.thumb ? (
              <img src={frame.thumb} alt="" width={160} height={100} />
            ) : (
              <span className="record-frame-empty" aria-hidden="true" />
            )}
            <span className="record-frame-at record-num" aria-hidden="true">
              {clockOf(frame.atMs)}
            </span>
            <button
              type="button"
              className="record-frame-remove"
              aria-label={`Remove picture ${index + 1} of ${frames.length}, at ${clockOf(frame.atMs)}`}
              onKeyDown={(event) => keys(event, index)}
              onClick={() => remove(index, frame.id)}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
