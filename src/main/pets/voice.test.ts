import { describe, expect, it } from "vitest";
import { PET_VOICE_IDS } from "../../shared/pets/kinds";
import {
  ELEVENLABS_ORIGIN,
  ELEVENLABS_VOICES,
  ElevenLabsClient,
  failureOf,
  STT_MODEL,
  TTS_MODEL,
  VoiceError,
} from "./voice";

const KEY = "sk_test_do_not_log_0123456789";

interface Seen {
  url: string;
  init: RequestInit;
}

/** A fetch that records each call and answers from a script. */
function scripted(
  ...answers: Array<Response | Error | ((seen: Seen) => Response)>
) {
  const seen: Seen[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const call = { url: String(input), init: init ?? {} };
    seen.push(call);
    const next = answers[Math.min(seen.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(call) : (next as Response);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const client = (fetchImpl: typeof fetch, key: string | null = KEY) =>
  new ElevenLabsClient({
    getKey: async () => key ?? undefined,
    fetch: fetchImpl,
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("the ElevenLabs client's requests", () => {
  it("transcribes with Scribe: the key header, multipart, no redirect", async () => {
    const { seen, fetchImpl } = scripted(json({ text: "  hello there " }));
    const text = await client(fetchImpl).transcribe(new Uint8Array([1, 2, 3]));
    expect(text).toBe("hello there");
    expect(seen).toHaveLength(1);
    const call = seen[0] as Seen;
    expect(call.url).toBe(`${ELEVENLABS_ORIGIN}/v1/speech-to-text`);
    expect(call.init.method).toBe("POST");
    expect(call.init.redirect).toBe("manual");
    expect((call.init.headers as Record<string, string>)["xi-api-key"]).toBe(
      KEY,
    );
    const form = call.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model_id")).toBe(STT_MODEL);
    expect(STT_MODEL).toBe("scribe_v1");
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("speaks with Flash as 22.05 kHz PCM, to the premade voice, no redirect", async () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0]);
    const { seen, fetchImpl } = scripted(new Response(pcm));
    const out = await client(fetchImpl).speak("Good morning.", "darian");
    expect(out).toEqual(pcm);
    const call = seen[0] as Seen;
    expect(call.url).toBe(
      `${ELEVENLABS_ORIGIN}/v1/text-to-speech/${ELEVENLABS_VOICES.darian}?output_format=pcm_22050`,
    );
    expect(call.init.redirect).toBe("manual");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe(KEY);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init.body as string)).toEqual({
      text: "Good morning.",
      model_id: TTS_MODEL,
    });
    expect(TTS_MODEL).toBe("eleven_flash_v2_5");
  });

  it("only ever sends to the one hard-coded origin, for every voice", async () => {
    const { seen, fetchImpl } = scripted(() => new Response(new Uint8Array(2)));
    for (const voice of PET_VOICE_IDS) {
      await client(fetchImpl).speak("Hi.", voice);
    }
    expect(seen).toHaveLength(6);
    for (const call of seen) {
      expect(call.url.startsWith("https://api.elevenlabs.io/v1/")).toBe(true);
    }
    expect(new Set(Object.values(ELEVENLABS_VOICES)).size).toBe(6);
  });

  it("drops an odd trailing byte so samples stay whole", async () => {
    const { fetchImpl } = scripted(new Response(new Uint8Array(5)));
    expect((await client(fetchImpl).speak("Hi.", "talia")).length).toBe(4);
  });

  it("with no key makes no request at all", async () => {
    const { seen, fetchImpl } = scripted(json({ text: "x" }));
    await expect(
      client(fetchImpl, null).transcribe(new Uint8Array(1)),
    ).rejects.toMatchObject({ failure: "key-missing" });
    await expect(
      client(fetchImpl, "   ").speak("Hi.", "talia"),
    ).rejects.toMatchObject({ failure: "key-missing" });
    expect(seen).toEqual([]);
  });
});

describe("what a refusal means", () => {
  const speak = (response: Response) =>
    client(scripted(response).fetchImpl).speak("Hi.", "talia");

  it("401 and 403 are a refused key", async () => {
    await expect(
      speak(json({ detail: { status: "invalid_api_key" } }, 401)),
    ).rejects.toMatchObject({ failure: "key-refused" });
    await expect(
      speak(new Response("", { status: 403 })),
    ).rejects.toMatchObject({ failure: "key-refused" });
  });

  it("a 401 that says quota_exceeded is the quota line, not a refused key", async () => {
    await expect(
      speak(json({ detail: { status: "quota_exceeded", message: "x" } }, 401)),
    ).rejects.toMatchObject({ failure: "quota" });
  });

  it("429 is the quota, unless it says too many at once", async () => {
    await expect(
      speak(new Response("", { status: 429 })),
    ).rejects.toMatchObject({ failure: "quota" });
    await expect(
      speak(json({ detail: { status: "too_many_concurrent_requests" } }, 429)),
    ).rejects.toMatchObject({ failure: "busy" });
  });

  it("anything else is unavailable", async () => {
    await expect(
      speak(new Response("", { status: 500 })),
    ).rejects.toMatchObject({ failure: "unavailable" });
    await expect(
      speak(new Response("", { status: 404 })),
    ).rejects.toMatchObject({ failure: "unavailable" });
    expect(failureOf(401, "not json")).toBe("key-refused");
  });

  it("a thrown fetch is unavailable and shows no key", async () => {
    const { fetchImpl } = scripted(new Error(`boom ${KEY}`));
    const caught = await client(fetchImpl)
      .speak("Hi.", "talia")
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(VoiceError);
    expect((caught as VoiceError).failure).toBe("unavailable");
    expect(String((caught as Error).message)).not.toContain(KEY);
  });
});

describe("it never follows a redirect and caps what it reads", () => {
  it("treats a 302 as a failure and never asks for the address it names", async () => {
    const { seen, fetchImpl } = scripted(
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/steal" },
      }),
      new Response(new Uint8Array(2)),
    );
    await expect(client(fetchImpl).speak("Hi.", "talia")).rejects.toMatchObject(
      { failure: "unavailable" },
    );
    expect(seen).toHaveLength(1);
    expect(seen.every((c) => c.url.startsWith(ELEVENLABS_ORIGIN))).toBe(true);
  });

  it("treats an opaque redirect the same way", async () => {
    const fake = new Response(null, { status: 200 });
    Object.defineProperty(fake, "type", { value: "opaqueredirect" });
    const { fetchImpl } = scripted(fake);
    await expect(
      client(fetchImpl).transcribe(new Uint8Array(1)),
    ).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("refuses speech past the size cap", async () => {
    const big = new Uint8Array(6 * 1024 * 1024 + 2);
    const { fetchImpl } = scripted(new Response(big));
    await expect(client(fetchImpl).speak("Hi.", "talia")).rejects.toMatchObject(
      { failure: "unavailable" },
    );
  });

  it("refuses a transcript answer that is not the expected JSON", async () => {
    const { fetchImpl } = scripted(json({ words: [] }));
    await expect(
      client(fetchImpl).transcribe(new Uint8Array(1)),
    ).rejects.toMatchObject({ failure: "unavailable" });
  });

  it("gives every call a deadline", async () => {
    const { seen, fetchImpl } = scripted(new Response(new Uint8Array(2)));
    await client(fetchImpl).speak("Hi.", "talia");
    const signal = seen[0]?.init.signal;
    expect(signal?.aborted).toBe(false);
  });
});
