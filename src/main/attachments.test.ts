import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AttachInspector,
  Attachments,
  attachmentIds,
  pageBytes,
  sweepFiles,
} from "./attachments";
import { buildBackup } from "./backup";
import { ATTACH_LIMITS } from "./file-kind";
import { Store } from "./store";

let dir: string;
let store: Store;
let files: Attachments;
let assistantId: string;
const inspector: AttachInspector = {
  pdfPages: async () => 3,
  preview: async () => "data:image/png;base64,AAAA",
};

const text = (s: string) => new TextEncoder().encode(s);
const pdf = () => text("%PDF-1.7\nhello");
const note = () => text("a note");

function png(): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set([...text("IHDR")], 12);
  new DataView(b.buffer).setUint32(16, 10);
  new DataView(b.buffer).setUint32(20, 10);
  return b;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openstellar-attach-"));
  store = new Store(dir);
  files = new Attachments(dir, inspector);
  assistantId = store.saveAssistant({
    name: "Scout",
    group: "",
    pet: "glim",
    color: "sky",
    brief: "Read things.",
    skills: [],
  }).id;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Adds files and sends them in one message, as the app does. */
async function sendWith(...bytes: [string, Uint8Array][]) {
  const ids: string[] = [];
  for (const [name, b] of bytes)
    ids.push((await files.add(assistantId, name, b)).id);
  const refs = files.commit(assistantId, ids);
  return store.appendMessage(
    assistantId,
    "user",
    "see these",
    false,
    [],
    undefined,
    new Date(),
    refs,
  );
}

const stored = () => {
  const folder = join(dir, "attachments", assistantId);
  return existsSync(folder) ? readdirSync(folder) : [];
};

describe("what the page may hand over", () => {
  it("takes bytes, never a path", () => {
    expect(pageBytes(png())).toBeInstanceOf(Uint8Array);
    expect(() => pageBytes("/etc/passwd")).toThrow("That is not allowed.");
    expect(() => pageBytes({ path: "/etc/passwd" })).toThrow(
      "That is not allowed.",
    );
    expect(() => pageBytes([1, 2, 3])).toThrow("That is not allowed.");
    expect(() =>
      pageBytes(new Uint8Array(ATTACH_LIMITS.fileBytes + 1)),
    ).toThrow(/at most 20 MB/);
  });

  it("takes only well-formed ids for a message, at most ten", () => {
    expect(attachmentIds(undefined)).toEqual([]);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(attachmentIds([id])).toEqual([id]);
    expect(() => attachmentIds(["../state.json"])).toThrow();
    expect(() => attachmentIds("x")).toThrow();
    expect(() => attachmentIds(Array(11).fill(id))).toThrow();
  });
});

describe("the message box", () => {
  it("checks a file and keeps it in memory until it is sent", async () => {
    const added = await files.add(assistantId, "shot.png", png());
    expect(added).toMatchObject({
      name: "shot.png",
      kind: "png",
      size: 33,
      preview: "data:image/png;base64,AAAA",
    });
    expect(files.pending(assistantId)).toHaveLength(1);
    expect(stored()).toEqual([]);
  });

  it("names the stored file from the checked kind, never the given name", async () => {
    const message = await sendWith(["evil.exe", pdf()]);
    const ref = message.attachments?.[0];
    expect(ref).toMatchObject({ kind: "pdf", name: "evil.exe", pages: 3 });
    expect(ref?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored()).toEqual([`${ref?.id}.pdf`]);
    expect(files.pending(assistantId)).toEqual([]);
  });

  it("refuses a PDF with too many pages, and one that cannot be opened", async () => {
    const many = new Attachments(dir, { pdfPages: async () => 201 });
    await expect(many.add(assistantId, "a.pdf", pdf())).rejects.toThrow(
      /201 pages/,
    );
    const broken = new Attachments(dir, {
      pdfPages: async () => {
        throw new Error("boom");
      },
    });
    await expect(broken.add(assistantId, "a.pdf", pdf())).rejects.toThrow(
      /could not be read/,
    );
  });

  it("holds at most ten files and 50 MB a message", async () => {
    for (let i = 0; i < ATTACH_LIMITS.files; i += 1)
      await files.add(assistantId, `n${i}.txt`, note());
    await expect(files.add(assistantId, "x.txt", note())).rejects.toThrow(
      /up to 10 files/,
    );
    const other = new Attachments(dir, inspector);
    const big = new Uint8Array(19 * 1024 * 1024).fill(0x41);
    await other.add(assistantId, "a.txt", big);
    await other.add(assistantId, "b.txt", big);
    await expect(other.add(assistantId, "c.txt", big)).rejects.toThrow(
      /at most 50 MB/,
    );
  });

  it("sends only files that wait for this assistant", async () => {
    const added = await files.add(assistantId, "a.txt", note());
    expect(() =>
      files.commit(assistantId, ["11111111-1111-4111-8111-111111111111"]),
    ).toThrow(/no longer waiting/);
    const other = store.saveAssistant({
      name: "Other",
      group: "",
      pet: "glim",
      color: "sky",
      brief: "",
      skills: [],
    }).id;
    expect(() => files.commit(other, [added.id])).toThrow(/no longer waiting/);
  });

  it("finds a sent file only by an id it made", async () => {
    const message = await sendWith(["a.txt", note()]);
    const id = message.attachments?.[0]?.id ?? "";
    expect(files.fileOf(assistantId, id)).toMatch(/\.txt$/);
    expect(files.fileOf(assistantId, "../../state.json")).toBeUndefined();
    expect(() => files.fileOf("../x", id)).toThrow();
  });

  it("reads a sent file back for the model", async () => {
    const message = await sendWith(["a.txt", note()]);
    const ref = message.attachments?.[0];
    if (!ref) throw new Error("no ref");
    const loaded = files.load(assistantId, ref);
    expect(new TextDecoder().decode(loaded?.bytes)).toBe("a note");
  });
});

describe("files go with their chat", () => {
  it("when the assistant is removed", async () => {
    await sendWith(["a.txt", note()]);
    expect(stored()).toHaveLength(1);
    store.removeAssistant(assistantId);
    expect(existsSync(join(dir, "attachments", assistantId))).toBe(false);
  });

  it("when every chat is deleted", async () => {
    await sendWith(["a.txt", note()]);
    store.deleteAllChats();
    expect(existsSync(join(dir, "attachments"))).toBe(false);
  });

  it("when their message falls off the end of the chat", async () => {
    const first = await sendWith(["a.txt", note()]);
    for (let i = 0; i < 500; i += 1)
      store.appendMessage(assistantId, "assistant", `reply ${i}`);
    expect(store.messages(assistantId).some((m) => m.id === first.id)).toBe(
      false,
    );
    expect(stored()).toEqual([]);
  });

  it("and a sweep removes files no chat refers to", async () => {
    const kept = await sendWith(["a.txt", note()]);
    const folder = join(dir, "attachments", assistantId);
    writeFileSync(
      join(folder, "22222222-2222-4222-8222-222222222222.txt"),
      "x",
    );
    writeFileSync(join(folder, `${kept.attachments?.[0]?.id}.txt.1.tmp`), "x");
    const gone = join(
      dir,
      "attachments",
      "33333333-3333-4333-8333-333333333333",
    );
    mkdirSync(gone);
    writeFileSync(join(gone, "x.txt"), "x");
    const ids = new Set(store.assistants().map((a) => a.id));
    sweepFiles(dir, (id) => (ids.has(id) ? store.messages(id) : undefined));
    expect(stored()).toEqual([`${kept.attachments?.[0]?.id}.txt`]);
    expect(existsSync(gone)).toBe(false);
  });
});

describe("nothing of a file leaves in a file the person exports", () => {
  it("not in a backup, even with chats", async () => {
    await sendWith(["secret.txt", text("the secret word")]);
    const backup = JSON.stringify(buildBackup(store, true));
    expect(backup).toContain("see these");
    expect(backup).not.toContain("attachments");
    expect(backup).not.toContain("secret.txt");
    expect(backup).not.toContain("the secret word");
  });

  it("not in an exported assistant file", async () => {
    await sendWith(["secret.txt", text("the secret word")]);
    const file = JSON.stringify(store.exportFile(assistantId));
    expect(file).not.toContain("secret");
    expect(file).not.toContain("attachments");
  });

  it("and a chat brought in from a backup carries no file", () => {
    const restored = store.addImported(
      {
        name: "From backup",
        group: "",
        pet: "glim",
        color: "sky",
        brief: "",
        skills: [],
      },
      [],
    );
    expect(store.messages(restored.id)).toEqual([]);
    const raw = readFileSync(join(dir, "state.json"), "utf8");
    expect(raw).not.toContain("attachments");
  });
});
