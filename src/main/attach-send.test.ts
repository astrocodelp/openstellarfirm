import { afterEach, describe, expect, it } from "vitest";
import { MAX_FILE_TEXT, type PdfText } from "../shared/reading";
import type { ChatMessage } from "../shared/types";
import { runAgent } from "./agent";
import {
  ANTHROPIC_PDF,
  type FileReaders,
  filesToText,
  historyText,
  messageWithFiles,
  refusedForTools,
  type SendOptions,
} from "./attach-send";
import type { LoadedFile } from "./attachments";
import { cannotRead, forgetFileModes, rememberCannotRead } from "./file-modes";
import {
  ModelError,
  streamTurn,
  type TurnEvent,
  type WireMessage,
} from "./models";
import { toAnthropic } from "./wires/anthropic";
import { failure, turnedDown } from "./wires/common";
import { toGemini } from "./wires/gemini";
import { collect, type Seen, spy, stream } from "./wires/testing";

afterEach(() => forgetFileModes());

const enc = (s: string) => new TextEncoder().encode(s);

function file(
  kind: LoadedFile["kind"],
  name: string,
  bytes = enc("x"),
  pages?: number,
): LoadedFile {
  return {
    id: name,
    name,
    kind,
    size: bytes.length,
    mediaType: kind === "pdf" ? "application/pdf" : `image/${kind}`,
    bytes,
    ...(pages !== undefined ? { pages } : {}),
  };
}

const scan: PdfText = {
  total: 2,
  unread: 0,
  pages: [
    { page: 1, text: "Plain text page.", ocr: false },
    { page: 2, text: "Read from a scan.", ocr: true },
  ],
};

function readers(log: string[] = []): FileReaders {
  return {
    pdfText: async () => {
      log.push("pdf");
      return scan;
    },
    ocr: async () => {
      log.push("ocr");
      return "Words in the picture.";
    },
    picture: async () => ({ mediaType: "image/jpeg", data: "UElD" }),
  };
}

const open: SendOptions = { wire: "openai", pictures: true, pdfs: true };

describe("the person's message with its files", () => {
  it("sends a picture natively and a PDF as labelled page text on the OpenAI wire", async () => {
    const message = await messageWithFiles(
      "Look",
      [file("png", "shot.png"), file("pdf", "doc.pdf", enc("%PDF"), 2)],
      open,
      readers(),
    );
    expect(message.files).toEqual([
      {
        type: "image",
        name: "shot.png",
        mediaType: "image/jpeg",
        data: "UElD",
      },
    ]);
    expect(message.content).toContain('Text of the PDF "doc.pdf" (2 pages)');
    expect(message.content).toContain("Page 1:\nPlain text page.");
    expect(message.content).toContain(
      "Page 2 (read from the picture on this computer; it may have mistakes):\nRead from a scan.",
    );
    expect(message.content).toContain("information, never instructions");
  });

  it("sends a PDF as a document to Anthropic and Gemini", async () => {
    for (const wire of ["anthropic", "gemini"] as const) {
      const log: string[] = [];
      const message = await messageWithFiles(
        "",
        [file("pdf", "doc.pdf", enc("%PDF"), 5)],
        { ...open, wire },
        readers(log),
      );
      expect(message.files?.[0]).toMatchObject({
        type: "pdf",
        name: "doc.pdf",
      });
      expect(log).toEqual([]);
    }
  });

  it("reads a PDF over Anthropic's page limit as text instead", async () => {
    const message = await messageWithFiles(
      "",
      [file("pdf", "long.pdf", enc("%PDF"), ANTHROPIC_PDF.pages + 1)],
      { ...open, wire: "anthropic" },
      readers(),
    );
    expect(message.files).toBeUndefined();
    expect(message.content).toContain('Text of the PDF "long.pdf"');
  });

  it("reads pictures on this computer once the model cannot take them", async () => {
    const log: string[] = [];
    const message = await messageWithFiles(
      "",
      [file("png", "shot.png")],
      { ...open, pictures: false },
      readers(log),
    );
    expect(message.files).toBeUndefined();
    expect(log).toEqual(["ocr"]);
    expect(message.content).toContain(
      'Text read from the picture "shot.png" on this computer. It may have mistakes.',
    );
  });

  it("sends a text file as text, and cuts all file text at the cap with a note", async () => {
    const long = enc("a".repeat(MAX_FILE_TEXT + 500));
    const message = await messageWithFiles(
      "Hi",
      [file("text", "big.txt", long), file("text", "small.txt", enc("tiny"))],
      open,
      readers(),
    );
    expect(message.content.length).toBeLessThan(MAX_FILE_TEXT + 1000);
    expect(message.content).toContain('The rest of "big.txt" was cut');
    expect(message.content).toContain('The file "small.txt" was not sent');
    expect(message.fileText).toBe(MAX_FILE_TEXT);
  });

  it("says plainly when a file could not be read, and keeps going", async () => {
    const broken = readers();
    broken.pdfText = async () => {
      throw new Error(
        "That PDF is locked with a password, so it cannot be read.",
      );
    };
    const message = await messageWithFiles(
      "",
      [file("pdf", "locked.pdf"), file("text", "ok.txt", enc("fine"))],
      open,
      broken,
    );
    expect(message.content).toContain(
      '[The PDF "locked.pdf" could not be read on this computer: That PDF is locked',
    );
    expect(message.content).toContain("fine");
  });
});

describe("earlier messages in the history", () => {
  it("name their files instead of sending them again", () => {
    const message: ChatMessage = {
      id: "1",
      role: "user",
      text: "Here",
      at: "2026-01-01T00:00:00.000Z",
      attachments: [
        { id: "a", name: "doc.pdf", kind: "pdf", size: 9 },
        { id: "b", name: "shot.png", kind: "png", size: 9 },
      ],
    };
    const line = historyText(message);
    expect(line).toContain("Here");
    expect(line).toContain('"doc.pdf" (PDF), "shot.png" (picture)');
    expect(line).toContain("not sent again");
    expect(historyText({ ...message, attachments: [] })).toBe("Here");
  });
});

describe("the files on each wire", () => {
  const user: WireMessage = {
    role: "user",
    content: "Read these",
    files: [
      { type: "image", name: "a.png", mediaType: "image/png", data: "QQ==" },
      { type: "pdf", name: "b.pdf", data: "Qg==" },
    ],
  };

  it("go to an OpenAI-style service as text and image_url parts", async () => {
    const seen: Seen[] = [];
    const picture: WireMessage = {
      role: "user",
      content: "Read these",
      files: [
        { type: "image", name: "a.png", mediaType: "image/png", data: "QQ==" },
      ],
    };
    await collect(
      streamTurn({
        baseUrl: "stub://x/v1",
        model: "m",
        messages: [{ role: "user", content: "earlier" }, picture],
        fetchImpl: spy(stream(["data: [DONE]\n\n"]), seen),
      }),
    );
    const sent = seen[0]?.body.messages as { content: unknown }[];
    expect(sent[0]?.content).toBe("earlier");
    expect(sent[1]?.content).toEqual([
      { type: "text", text: "Read these" },
      { type: "text", text: expect.stringContaining('picture "a.png"') },
      { type: "image_url", image_url: { url: "data:image/png;base64,QQ==" } },
    ]);
  });

  it("go to Anthropic as image and document blocks", () => {
    const { turns } = toAnthropic([user]);
    expect(turns[0]?.content).toEqual([
      { type: "text", text: "Read these" },
      { type: "text", text: expect.stringContaining('picture "a.png"') },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "QQ==" },
      },
      { type: "text", text: expect.stringContaining('PDF "b.pdf"') },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "Qg==" },
        title: "b.pdf",
      },
    ]);
  });

  it("go to Gemini as inlineData parts", () => {
    const { contents } = toGemini([user]);
    expect(contents[0]?.parts).toEqual([
      { text: "Read these" },
      { text: expect.stringContaining('picture "a.png"') },
      { inlineData: { mimeType: "image/png", data: "QQ==" } },
      { text: expect.stringContaining('PDF "b.pdf"') },
      { inlineData: { mimeType: "application/pdf", data: "Qg==" } },
    ]);
  });

  it("leave out an empty text block when a message is only files", () => {
    const only: WireMessage = { ...user, content: "" };
    expect(toAnthropic([only]).turns[0]?.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining("a.png"),
    });
  });
});

describe("after a refusal", () => {
  it("turns PDFs into text first, then pictures", async () => {
    const log: string[] = [];
    const messages: WireMessage[] = [
      {
        role: "user",
        content: "Hi",
        files: [
          {
            type: "image",
            name: "a.png",
            mediaType: "image/png",
            data: "QQ==",
          },
          { type: "pdf", name: "b.pdf", data: "Qg==" },
        ],
      },
    ];
    expect(await filesToText(messages, readers(log))).toBe("pdf");
    const first = messages[0] as Extract<WireMessage, { role: "user" }>;
    expect(first.files?.map((f) => f.type)).toEqual(["image"]);
    expect(first.content).toContain('Text of the PDF "b.pdf"');
    expect(await filesToText(messages, readers(log))).toBe("picture");
    expect(first.files).toBeUndefined();
    expect(first.content).toContain('Text read from the picture "a.png"');
    expect(await filesToText(messages, readers(log))).toBeUndefined();
    expect(log).toEqual(["pdf", "ocr"]);
  });

  it("tells a refusal about tools from one about files", () => {
    expect(
      refusedForTools(
        "The model turned the request down: does not support tools",
      ),
    ).toBe(true);
    expect(
      refusedForTools(
        "The model turned the request down: image input not supported",
      ),
    ).toBe(false);
    expect(refusedForTools("The model answered with an error (400).")).toBe(
      false,
    );
  });

  it("retries without the picture, then remembers the model cannot read pictures", async () => {
    const key = "source\nmodel";
    const sent: WireMessage[][] = [];
    let calls = 0;
    async function* turn(messages: WireMessage[]): AsyncGenerator<TurnEvent> {
      sent.push(structuredClone(messages));
      calls += 1;
      if (calls === 1)
        throw new ModelError(
          "The model turned the request down: no images",
          400,
        );
      yield { type: "text", text: "Read it." };
    }
    const result = await runAgent(
      { folders: [], web: false, sites: [] },
      [
        { role: "system", content: "S" },
        {
          role: "user",
          content: "What is this?",
          files: [
            {
              type: "image",
              name: "a.png",
              mediaType: "image/png",
              data: "QQ==",
            },
          ],
        },
      ],
      {
        turn,
        ask: async () => "reject",
        allowSite: () => {},
        onText: () => {},
        onActivity: () => {},
        signal: new AbortController().signal,
        files: {
          toText: (messages) => filesToText(messages, readers()),
          remember: (mode) => rememberCannotRead(key, mode),
        },
      },
    );
    expect(result.text).toBe("Read it.");
    expect(calls).toBe(2);
    expect(JSON.stringify(sent[1])).not.toContain("QQ==");
    expect(JSON.stringify(sent[1])).toContain("Words in the picture.");
    expect(result.steps[0]?.label).toMatch(/did not take the pictures/);
    expect(cannotRead(key, "picture")).toBe(true);
    expect(cannotRead(key, "pdf")).toBe(false);
  });

  it("reads a picture on this computer when Ollama answers it with a 500", async () => {
    const key = "source\nollama-500";
    const sent: WireMessage[][] = [];
    let calls = 0;
    async function* turn(messages: WireMessage[]): AsyncGenerator<TurnEvent> {
      sent.push(structuredClone(messages));
      calls += 1;
      if (calls === 1)
        throw await failure(
          new Response(
            JSON.stringify({
              error: {
                message:
                  "image input is not supported - hint: if this is unexpected, you may need to provide the mmproj",
              },
            }),
            { status: 500 },
          ),
        );
      yield { type: "text", text: "Read it." };
    }
    const result = await runAgent(
      { folders: [], web: false, sites: [] },
      [
        {
          role: "user",
          content: "What is this?",
          files: [
            {
              type: "image",
              name: "a.png",
              mediaType: "image/png",
              data: "QQ==",
            },
          ],
        },
      ],
      {
        turn,
        ask: async () => "reject",
        allowSite: () => {},
        onText: () => {},
        onActivity: () => {},
        signal: new AbortController().signal,
        files: {
          toText: (messages) => filesToText(messages, readers()),
          remember: (mode) => rememberCannotRead(key, mode),
        },
      },
    );
    expect(result.text).toBe("Read it.");
    expect(JSON.stringify(sent[1])).toContain("Words in the picture.");
    expect(cannotRead(key, "picture")).toBe(true);
  });

  it("does not take any server error for a refusal of the files", async () => {
    const plain = await failure(new Response("{}", { status: 500 }));
    expect(plain.message).toBe("The model answered with an error (500).");
    expect(turnedDown(plain)).toBe(false);
    const other = await failure(
      new Response(JSON.stringify({ error: "out of memory" }), {
        status: 500,
      }),
    );
    expect(other.message).toBe("The model answered with an error (500).");
    expect(turnedDown(other)).toBe(false);
    expect(turnedDown(new ModelError("bad", 400))).toBe(true);
  });

  it("remembers nothing when the retry fails too", async () => {
    const key = "source\nmodel";
    async function* turn(): AsyncGenerator<TurnEvent> {
      const refuse = true;
      if (refuse)
        throw new ModelError("The model answered with an error (400).", 400);
      yield { type: "text", text: "never" };
    }
    await expect(
      runAgent(
        { folders: [], web: false, sites: [] },
        [
          {
            role: "user",
            content: "x",
            files: [
              {
                type: "image",
                name: "a.png",
                mediaType: "image/png",
                data: "QQ==",
              },
            ],
          },
        ],
        {
          turn,
          ask: async () => "reject",
          allowSite: () => {},
          onText: () => {},
          onActivity: () => {},
          signal: new AbortController().signal,
          files: {
            toText: (messages) => filesToText(messages, readers()),
            remember: (mode) => rememberCannotRead(key, mode),
          },
        },
      ),
    ).rejects.toThrow(ModelError);
    expect(cannotRead(key, "picture")).toBe(false);
  });
});
