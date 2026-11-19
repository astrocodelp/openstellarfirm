import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { imaAdpcmWav } from "../../shared/pets/adpcm";
import type { PetVoiceId } from "../../shared/pets/kinds";
import { PET_LINES, petLine } from "../../shared/pets/lines";
import {
  parseClaimResponse,
  parseInboxResponse,
  parsePairResponse,
  parsePetErrorBody,
  parseTurnSaved,
} from "../../shared/pets/protocol";
import { spokenAnswer } from "../../shared/pets/spoken";
import { decodeVoicePack } from "../../shared/pets/voice-pack";
import type { PetOutcome, PetRun, PetTurnHost } from "./backend";
import {
  call,
  jsonHeaders,
  makeRig,
  newPetSecret,
  pairBody,
  type Rig,
} from "./rig.testkit";
import { VOICE_SECRET } from "./service";
import type { PetStore, StoredPet } from "./store";
import { type VoiceClient, VoiceError, type VoiceFailure } from "./voice";

/** A speech service that never touches the network and remembers what it was asked. */
class StubVoice implements VoiceClient {
  heard = "What is on my list today";
  failTranscribe: VoiceFailure | null = null;
  failSpeak: VoiceFailure | null = null;
  readonly spoken: { text: string; voice: PetVoiceId }[] = [];
  transcripts = 0;
  async transcribe(wav: Uint8Array): Promise<string> {
    this.transcripts += 1;
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    if (this.failTranscribe) throw new VoiceError(this.failTranscribe);
    return this.heard;
  }
  async speak(text: string, voice: PetVoiceId): Promise<Uint8Array> {
    this.spoken.push({ text, voice });
    if (this.failSpeak) throw new VoiceError(this.failSpeak);
    const samples = new Int16Array(400 + text.length);
    samples.fill(1234);
    return new Uint8Array(samples.buffer);
  }
}

type Mode = "answer" | "needs" | "hang" | "fail";

/** The app's side, as a test sees it: it can only start a run and say it waits. */
class StubHost implements PetTurnHost {
  mode: Mode = "answer";
  answerText = "Your list has three things on it.";
  busyIds = new Set<string>();
  readonly assistants = [{ id: "main", role: "developer" }, { id: "other" }];
  readonly starts: { id: string; text: string }[] = [];
  finish: (outcome: PetOutcome) => void = () => {};
  target(wanted: string | null) {
    return (
      this.assistants.find((a) => a.id === wanted) ?? this.assistants[0] ?? null
    );
  }
  busy(id: string): boolean {
    return this.busyIds.has(id);
  }
  async start(id: string, text: string): Promise<PetRun> {
    this.starts.push({ id, text });
    const outcome = new Promise<PetOutcome>((resolve) => {
      this.finish = resolve;
    });
    if (this.mode === "answer") {
      this.finish({ kind: "answered", text: this.answerText });
    } else if (this.mode === "fail") {
      this.finish({ kind: "failed" });
    }
    const needsYou =
      this.mode === "needs" ? Promise.resolve() : new Promise<void>(() => {});
    return { chat: id, run: `run-${this.starts.length}`, outcome, needsYou };
  }
}

let rig: Rig;

/** Changes the saved pets the way the settings screen will, for a test. */
function editPets(edit: (pet: StoredPet) => void): void {
  const store = (rig.service as unknown as { store: PetStore }).store;
  store.change((state) => {
    for (const pet of state.pets) edit(pet);
  });
}

afterEach(async () => {
  await rig?.cleanup();
});

async function started(options: { wait?: number } = {}) {
  const voice = new StubVoice();
  const host = new StubHost();
  rig = makeRig({
    voice,
    turns: host,
    firstAnswerWaitMs: options.wait ?? 2000,
  });
  const status = await rig.service.turnOn();
  const port = status.port as number;
  const fingerprint = status.fingerprint as string;
  const get = (
    method: string,
    path: string,
    init?: Parameters<typeof call>[4],
  ) => call(port, fingerprint, method, path, init);
  const { code } = await rig.service.startAdding();
  const pet = newPetSecret();
  const paired = parsePairResponse(
    (
      await get("POST", "/api/pets/pair", {
        headers: jsonHeaders,
        body: pairBody(code, pet.deviceKey),
      })
    ).json,
  );
  if (!paired.ok) throw new Error(paired.error);
  await rig.service.confirm(paired.value.confirmCode);
  const claimed = parseClaimResponse(
    (
      await get("POST", "/api/pets/pair/claim", {
        headers: jsonHeaders,
        body: JSON.stringify({
          requestId: paired.value.requestId,
          deviceSecret: pet.secret,
        }),
      })
    ).json,
  );
  if (!claimed.ok) throw new Error(claimed.error);
  const auth = { Authorization: `Bearer ${claimed.value.token}` };
  const note = imaAdpcmWav(
    Int16Array.from({ length: 16_000 }, (_, i) =>
      Math.round(8000 * Math.sin(i / 9)),
    ),
    16_000,
  );
  const turn = (
    headers: Record<string, string> = {},
    body: Buffer = Buffer.from(note),
  ) =>
    get("POST", "/api/pets/turn", {
      headers: {
        ...auth,
        "Content-Type": "audio/wav",
        "X-Pet-Turn": randomUUID(),
        ...headers,
      },
      body,
    });
  return {
    voice,
    host,
    get,
    auth,
    turn,
    id: claimed.value.deviceId,
    port,
    fingerprint,
  };
}

const lineOf = (headers: Record<string, unknown>) =>
  decodeURIComponent(String(headers["x-pet-line"]));

describe("a live turn", () => {
  it("is heard, sent as the owner's message and answered in speech", async () => {
    const { voice, host, turn } = await started();
    const answer = await turn();
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("audio/L16;rate=22050");
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(answer.headers["x-pet-state"]).toBe("answered");
    expect(answer.headers["x-pet-chat"]).toBe("main");
    expect(answer.headers["x-pet-run"]).toBe("run-1");
    const said = spokenAnswer(host.answerText);
    expect(said).not.toBe("");
    expect(lineOf(answer.headers)).toBe(said);
    // The words are the recording's own, sent to the pet's chosen assistant.
    expect(host.starts).toEqual([{ id: "main", text: voice.heard }]);
    expect(voice.spoken).toEqual([{ text: said, voice: "talia" }]);
    expect(answer.bytes.length).toBe((400 + said.length) * 2);
    expect(answer.bytes.readInt16LE(0)).toBe(1234);
  });

  it("goes to the assistant picked in the pet's settings", async () => {
    const { host, turn, id } = await started();
    await rig.service.setConfig(id, { assistantId: "other" });
    expect((await turn()).status).toBe(200);
    expect(host.starts[0]?.id).toBe("other");
  });

  it("says only the short done line when Speak answers is off", async () => {
    const { voice, turn, id } = await started();
    await rig.service.setConfig(id, { speakAnswers: false });
    const answer = await turn();
    expect(answer.headers["x-pet-state"]).toBe("answered");
    expect(lineOf(answer.headers)).toBe(petLine("done").text);
    expect(voice.spoken.map((s) => s.text)).toEqual([petLine("done").text]);
  });

  it("does not speak an answer with a digit, an amount or a link", async () => {
    const { voice, host, turn } = await started();
    host.answerText =
      "I drafted a reply to jane@acme.com for the 4,200 EUR invoice 1187.";
    expect(spokenAnswer(host.answerText)).toBe("");
    const answer = await turn();
    expect(lineOf(answer.headers)).toBe(petLine("done").text);
    expect(voice.spoken.some((s) => /jane|4,200|1187/.test(s.text))).toBe(
      false,
    );
  });

  it("says the stopped line, state refused, when the answer failed", async () => {
    const { host, turn } = await started();
    host.mode = "fail";
    const answer = await turn();
    expect(answer.headers["x-pet-state"]).toBe("refused");
    expect(lineOf(answer.headers)).toBe(petLine("stopped").text);
  });

  it("says working after the wait, and the done notice follows later", async () => {
    const { host, turn, get, auth } = await started({ wait: 40 });
    host.mode = "hang";
    const answer = await turn();
    expect(answer.headers["x-pet-state"]).toBe("working");
    expect(lineOf(answer.headers)).toBe(petLine("working").text);
    host.finish({ kind: "answered", text: "Done." });
    rig.service.notify("done", {
      role: "developer",
      chat: "main",
      run: "run-1",
    });
    const inbox = parseInboxResponse(
      (await get("GET", "/api/pets/inbox?after=0&wait=0", { headers: auth }))
        .json,
    );
    expect(inbox.ok && inbox.value.notices.map((n) => n.kind)).toContain(
      "done",
    );
  });

  it("hears nothing: 422 heard_nothing, nothing sent", async () => {
    const { voice, host, turn } = await started();
    voice.heard = "  ...  ";
    const answer = await turn();
    expect(answer.status).toBe(422);
    expect(answer.json).toEqual({
      error: "heard_nothing",
      line: "didnt-catch",
    });
    expect(host.starts).toEqual([]);
  });

  it("answers busy, and sends nothing, while the assistant is answering", async () => {
    const { voice, host, turn } = await started();
    host.busyIds.add("main");
    const answer = await turn();
    expect(answer.status).toBe(429);
    expect(answer.json).toEqual({ error: "too_many", line: "busy" });
    expect(host.starts).toEqual([]);
    expect(voice.transcripts).toBe(1);
  });

  it("answers paused, and sends nothing, while the pet is paused", async () => {
    const { host, turn } = await started();
    editPets((pet) => {
      pet.settings = { ...pet.settings, paused: true };
    });
    const answer = await turn();
    expect([answer.status, answer.json]).toEqual([
      409,
      { error: "paused", line: "paused" },
    ]);
    expect(host.starts).toEqual([]);
  });

  it("takes a turn id once", async () => {
    const { host, turn } = await started();
    const turnId = randomUUID();
    expect((await turn({ "X-Pet-Turn": turnId })).status).toBe(200);
    const again = await turn({ "X-Pet-Turn": turnId });
    expect([again.status, again.json]).toEqual([
      208,
      { status: "already-received" },
    ]);
    expect(host.starts).toHaveLength(1);
  });

  it("refuses a missing turn id, a body that is not a WAV and an empty one", async () => {
    const { turn, host } = await started();
    expect((await turn({ "X-Pet-Turn": "x" })).status).toBe(400);
    expect((await turn({}, Buffer.from("not a wav file at all"))).status).toBe(
      415,
    );
    expect((await turn({}, Buffer.alloc(0))).status).toBe(415);
    expect(host.starts).toEqual([]);
  });
});

describe("the voice key", () => {
  it("a refused key says so, and the same recording can be sent again", async () => {
    const { voice, host, turn } = await started();
    voice.failTranscribe = "key-refused";
    const turnId = randomUUID();
    const refused = await turn({ "X-Pet-Turn": turnId });
    expect(refused.status).toBe(401);
    expect(refused.json).toEqual({ error: "no_access", line: "no-access" });
    expect(parsePetErrorBody(refused.json).ok).toBe(true);
    expect((await rig.service.status()).voiceProblem).toMatch(
      /refused your key/,
    );
    voice.failTranscribe = null;
    expect((await turn({ "X-Pet-Turn": turnId })).status).toBe(200);
    expect((await rig.service.status()).voiceProblem).toBeNull();
    expect(host.starts).toHaveLength(1);
  });

  it("a missing key says the same short line", async () => {
    const { voice, turn } = await started();
    voice.failTranscribe = "key-missing";
    const answer = await turn();
    expect([answer.status, answer.json]).toEqual([
      401,
      { error: "no_access", line: "no-access" },
    ]);
    expect((await rig.service.status()).voiceProblem).toMatch(/Add it/);
  });

  it("a used-up quota says the quota line", async () => {
    const { voice, turn } = await started();
    voice.failTranscribe = "quota";
    const answer = await turn();
    expect([answer.status, answer.json]).toEqual([
      402,
      { error: "out_of_credits", line: "out-of-credits" },
    ]);
    expect((await rig.service.status()).voiceProblem).toMatch(/quota/);
    expect(petLine("out-of-credits").text).toMatch(/voice quota/);
  });

  it("a speech failure after the run started still answers its state, with no sound", async () => {
    const { voice, host, turn } = await started();
    voice.failSpeak = "key-refused";
    const answer = await turn();
    expect(answer.status).toBe(200);
    expect(answer.headers["x-pet-state"]).toBe("answered");
    expect(answer.bytes.length).toBe(0);
    expect(host.starts).toHaveLength(1);
    expect((await rig.service.status()).voiceProblem).toMatch(/refused/);
  });

  it("is kept in the keychain, write-only, and only a flag is ever returned", async () => {
    await started();
    const key = "sk_test_0123456789abcdef0123456789abcdef";
    const status = await rig.service.setVoiceKey(` ${key} `);
    expect(status.voiceKey).toBe(true);
    expect(rig.secrets.values.get(VOICE_SECRET)).toBe(key);
    expect(JSON.stringify(await rig.service.status())).not.toContain(key);
    await expect(rig.service.setVoiceKey("two words")).rejects.toThrow(
      /does not look like/,
    );
    expect((await rig.service.clearVoiceKey()).voiceKey).toBe(false);
    expect(rig.secrets.values.has(VOICE_SECRET)).toBe(false);
  });
});

describe("a step that waits for the owner", () => {
  it("reaches the pet only as the fixed needs-you line, and the inbox says needs you", async () => {
    const { host, turn, get, auth } = await started();
    host.mode = "needs";
    const answer = await turn();
    expect(answer.headers["x-pet-state"]).toBe("needs-approve");
    expect(lineOf(answer.headers)).toBe(petLine("needs-approve").text);

    rig.service.notify("approval", {
      role: "developer",
      chat: "main",
      run: "run-1",
    });
    const inbox = parseInboxResponse(
      (await get("GET", "/api/pets/inbox?after=0&wait=0", { headers: auth }))
        .json,
    );
    if (!inbox.ok) throw new Error(inbox.error);
    const notice = inbox.value.notices.find((n) => n.kind === "approval");
    expect(notice?.line).toBe(
      "Your Coder is waiting for your Approve. Open OpenStellarFirm to decide.",
    );
    expect(Object.keys(notice ?? {}).sort()).toEqual(
      ["at", "chat", "kind", "line", "role", "run", "seq"].sort(),
    );
  });

  it("can be told no more than that: the host has no way to answer a step", () => {
    const host = new StubHost();
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(host)).sort(),
    ).toEqual(["busy", "constructor", "start", "target"].sort());
  });

  it("no pet route can answer a card", async () => {
    const { get, auth } = await started();
    for (const [method, path] of [
      ["POST", "/api/pets/approve"],
      ["POST", "/api/pets/decide"],
      ["POST", "/api/pets/turn/approve"],
      ["POST", "/api/pets/inbox"],
      ["GET", "/api/approvals"],
    ] as const) {
      const answer = await get(method, path, { headers: auth, body: "{}" });
      expect([404], `${method} ${path}`).toContain(answer.status);
    }
  });
});

describe("a note saved offline", () => {
  const offline = { "X-Pet-Offline": "1" };

  it("is sent as a message and answers JSON, no audio", async () => {
    const { voice, host, turn } = await started();
    const answer = await turn(offline);
    expect(answer.status).toBe(200);
    const saved = parseTurnSaved(answer.json);
    expect(saved.ok && saved.value).toEqual({
      status: "sent",
      chat: "main",
      run: "run-1",
    });
    expect(host.starts).toEqual([{ id: "main", text: voice.heard }]);
    expect(voice.spoken).toEqual([]);
  });

  it("is kept as a draft, text only, when the pet's policy says draft", async () => {
    const { host, turn } = await started();
    editPets((pet) => {
      pet.settings = { ...pet.settings, savedNotes: "draft" };
    });
    const answer = await turn(offline);
    expect(answer.json).toEqual({ status: "draft", chat: "main" });
    expect(host.starts).toEqual([]);
    const drafts = (await rig.service.status()).drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe("What is on my list today");
    expect(JSON.stringify(drafts)).not.toMatch(/RIFF/);
    const discarded = await rig.service.discardDraft(drafts[0]?.id ?? "");
    expect(discarded.drafts).toEqual([]);
  });

  it("says empty for nothing heard", async () => {
    const { voice, turn } = await started();
    voice.heard = "";
    expect((await turn(offline)).json).toEqual({ status: "empty" });
  });
});

describe("the inbox and spoken notices", () => {
  it("long polls, wakes on a notice and numbers them upward", async () => {
    const { get, auth } = await started();
    const held = get("GET", "/api/pets/inbox?after=0&wait=5", {
      headers: auth,
    });
    const first = parseInboxResponse(
      (await get("GET", "/api/pets/inbox?after=0&wait=0", { headers: auth }))
        .json,
    );
    // The hello of pairing is already waiting.
    if (!first.ok) throw new Error(first.error);
    expect(first.value.notices[0]?.kind).toBe("message");
    expect(first.value.notices[0]?.line).toMatch(/^Hi, I'm Nova/);
    const top = first.value.next;
    const waiting = get("GET", `/api/pets/inbox?after=${top}&wait=5`, {
      headers: auth,
    });
    await new Promise((r) => setTimeout(r, 30));
    rig.service.notify("stopped", { role: "scientist" });
    const woken = parseInboxResponse((await waiting).json);
    if (!woken.ok) throw new Error(woken.error);
    expect(woken.value.notices).toHaveLength(1);
    expect(woken.value.notices[0]?.seq).toBe(top + 1);
    expect(woken.value.notices[0]?.line).toBe(
      "Your Scientist stopped before it finished. Open OpenStellarFirm to see why.",
    );
    expect(woken.value.next).toBe(top + 1);
    await held;
  });

  it("answers the counter's own top to a pet that is ahead", async () => {
    const { get, auth } = await started();
    const answer = parseInboxResponse(
      (
        await get("GET", "/api/pets/inbox?after=999999999999&wait=0", {
          headers: auth,
        })
      ).json,
    );
    if (!answer.ok) throw new Error(answer.error);
    expect(answer.value.notices).toEqual([]);
    expect(answer.value.next).toBeLessThan(999999999999);
  });

  it("speaks a notice by its number, and 404s one that is gone", async () => {
    const { voice, get, auth } = await started();
    rig.service.notify("done", { role: "scientist" });
    const inbox = parseInboxResponse(
      (await get("GET", "/api/pets/inbox?after=0&wait=0", { headers: auth }))
        .json,
    );
    if (!inbox.ok) throw new Error(inbox.error);
    const done = inbox.value.notices.find((n) => n.kind === "done");
    const said = await get("GET", `/api/pets/say/${done?.seq}`, {
      headers: auth,
    });
    expect(said.status).toBe(200);
    expect(said.headers["x-pet-state"]).toBeUndefined();
    expect(said.headers["content-type"]).toBe("audio/L16;rate=22050");
    expect(voice.spoken.at(-1)?.text).toBe(
      "Your Scientist finished. Open OpenStellarFirm to see it.",
    );
    const gone = await get("GET", "/api/pets/say/5", { headers: auth });
    expect([gone.status, gone.json]).toEqual([
      404,
      { error: "gone", line: "busy" },
    ]);
  });

  it("carries no budget or settings notice and no step text", async () => {
    const { get, auth } = await started();
    rig.service.notify("approval", { role: "developer" });
    const inbox = parseInboxResponse(
      (await get("GET", "/api/pets/inbox?after=0&wait=0", { headers: auth }))
        .json,
    );
    if (!inbox.ok) throw new Error(inbox.error);
    for (const notice of inbox.value.notices) {
      expect(["done", "approval", "stopped", "message"]).toContain(notice.kind);
      expect(notice.line).not.toMatch(/\d/);
    }
  });

  it("forgets a pet's notices when the pet is forgotten", async () => {
    const { id } = await started();
    rig.service.notify("done");
    await rig.service.forget(id);
    expect((await rig.service.status()).pets).toEqual([]);
  });

  it("queues nothing while Desk pets are off", async () => {
    const { auth } = await started();
    await rig.service.turnOff();
    rig.service.notify("done");
    const on = await rig.service.turnOn();
    const inbox = parseInboxResponse(
      (
        await call(
          on.port as number,
          on.fingerprint as string,
          "GET",
          "/api/pets/inbox?after=0&wait=0",
          { headers: auth },
        )
      ).json,
    );
    if (!inbox.ok) throw new Error(inbox.error);
    expect(inbox.value.notices.map((n) => n.kind)).toEqual(["message"]);
  });
});

describe("the voice pack", () => {
  it("says no key while there is none, with the key line", async () => {
    const { get } = await started();
    const answer = await get("GET", "/pets/voice/talia.sfvp");
    expect([answer.status, answer.json]).toEqual([
      503,
      { error: "voice_off", line: "no-access" },
    ]);
  });

  it("is made on first request with the key and kept as a private file", async () => {
    const { get, voice } = await started();
    rig.secrets.values.set(VOICE_SECRET, "sk_test_0123456789abcdef");
    const first = await get("GET", "/pets/voice/maisie.sfvp");
    expect([first.status, first.json]).toEqual([
      503,
      { error: "voice_off", line: "busy" },
    ]);
    const dir = join(rig.dir, "desk-pet-voice");
    let names: string[] = [];
    for (let i = 0; i < 100 && names.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      names = existsSync(dir)
        ? readdirSync(dir).filter((n) => /^maisie-[0-9a-f]{12}\.sfvp$/.test(n))
        : [];
    }
    expect(names).toHaveLength(1);
    if (process.platform !== "win32") {
      expect(statSync(join(dir, names[0] as string)).mode & 0o777).toBe(0o600);
    }
    // Every built-in line was said once, in that voice.
    expect(
      voice.spoken.filter((s) => s.voice === "maisie").map((s) => s.text),
    ).toEqual(PET_LINES.map((line) => line.text));
  });

  it("serves the made pack over TLS and answers unknown voices 404", async () => {
    const { get } = await started();
    rig.secrets.values.set(VOICE_SECRET, "sk_test_0123456789abcdef");
    expect((await get("GET", "/pets/voice/darian.sfvp")).status).toBe(503);
    // Wait for the background render.
    for (let i = 0; i < 100; i += 1) {
      const answer = await get("GET", "/pets/voice/darian.sfvp");
      if (answer.status === 200) {
        expect(answer.headers["content-type"]).toBe("application/octet-stream");
        const pack = decodeVoicePack(answer.bytes);
        expect(pack.clips.map((c) => c.id)).toEqual(
          PET_LINES.map((line) => line.id),
        );
        expect(pack.sampleRate).toBe(22050);
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("The voice pack was never made.");
  });

  it("answers 404 for a voice that is not one of the six", async () => {
    const { get } = await started();
    expect((await get("GET", "/pets/voice/nobody.sfvp")).status).toBe(404);
  });
});

describe("pet settings", () => {
  it("changes the voice the pet is told on its next heartbeat", async () => {
    const { id } = await started();
    const status = await rig.service.setConfig(id, { voice: "wyatt" });
    expect(status.pets[0]?.voice).toBe("wyatt");
    await expect(
      rig.service.setConfig(id, { voice: "nobody" as never }),
    ).rejects.toThrow(/voice/);
    await expect(
      rig.service.setConfig(id, { assistantId: "ghost" }),
    ).rejects.toThrow(/not here/);
  });
});
