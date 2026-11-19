import { describe, expect, it } from "vitest";
import {
  ATTACH_LIMITS,
  AttachError,
  cleanFileName,
  pictureSize,
  sniff,
} from "./file-kind";

/** Minimal headers for each kind, built by hand: no real picture is needed. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set([...new TextEncoder().encode("IHDR")], 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0 with the size.
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const sof = 2 + 18;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  new DataView(b.buffer).setUint16(sof + 5, height);
  new DataView(b.buffer).setUint16(sof + 7, width);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([...new TextEncoder().encode("GIF89a")]);
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}

function webpX(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  const t = new TextEncoder();
  b.set([...t.encode("RIFF")]);
  b.set([...t.encode("WEBP")], 8);
  b.set([...t.encode("VP8X")], 12);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return b;
}

const text = (s: string) => new TextEncoder().encode(s);

describe("what a file is, from its own bytes", () => {
  it("knows each picture kind by its signature and reads its size", () => {
    expect(sniff("a", png(800, 600))).toMatchObject({
      kind: "png",
      ext: "png",
      width: 800,
      height: 600,
    });
    expect(sniff("a", jpeg(1024, 768))).toMatchObject({
      kind: "jpeg",
      ext: "jpg",
      width: 1024,
      height: 768,
    });
    expect(sniff("a", gif(10, 20))).toMatchObject({
      kind: "gif",
      width: 10,
      height: 20,
    });
    expect(sniff("a", webpX(300, 200))).toMatchObject({
      kind: "webp",
      width: 300,
      height: 200,
    });
  });

  it("knows a PDF by its header", () => {
    expect(sniff("x.bin", text("%PDF-1.7\n..."))).toMatchObject({
      kind: "pdf",
      ext: "pdf",
    });
  });

  it("ignores the name for every kind it can prove from bytes", () => {
    // A PNG named .pdf is a PNG; a PDF named .png is a PDF.
    expect(sniff("report.pdf", png(10, 10)).kind).toBe("png");
    expect(sniff("photo.png", text("%PDF-1.4")).kind).toBe("pdf");
  });

  it("refuses a file named like a picture that is something else", () => {
    expect(() => sniff("fake.png", text("#!/bin/sh\necho hi\n"))).toThrow(
      AttachError,
    );
    expect(() => sniff("x.exe", new Uint8Array([0x4d, 0x5a, 0x90]))).toThrow(
      /cannot be attached/,
    );
  });

  it("takes plain UTF-8 text only when it is named as a text kind", () => {
    expect(sniff("notes.txt", text("hello\nworld"))).toMatchObject({
      kind: "text",
      ext: "txt",
    });
    expect(sniff("data.CSV", text("a,b\n1,2")).ext).toBe("csv");
    expect(sniff("x.json", text('{"a":1}')).mediaType).toBe("application/json");
    expect(() => sniff("script.js", text("alert(1)"))).toThrow(AttachError);
    // Not UTF-8, or full of control characters, is not text.
    expect(() => sniff("a.txt", new Uint8Array([0xff, 0xfe, 0x00]))).toThrow();
    expect(() => sniff("a.txt", new Uint8Array([0x41, 0x00, 0x42]))).toThrow();
  });

  it("refuses an empty file and one over 20 MB", () => {
    expect(() => sniff("a.txt", new Uint8Array(0))).toThrow(/empty/);
    const big = new Uint8Array(ATTACH_LIMITS.fileBytes + 1);
    big.set(png(10, 10));
    expect(() => sniff("a.png", big)).toThrow(/at most 20 MB/);
  });

  it("refuses a picture over 40 megapixels before it is decoded", () => {
    expect(() => pictureSize("png", png(8000, 5001))).toThrow(/40 megapixels/);
    expect(pictureSize("png", png(8000, 5000))).toEqual({
      width: 8000,
      height: 5000,
    });
    expect(() => sniff("a.gif", gif(10000, 10000))).toThrow(/40 megapixels/);
  });

  it("refuses a picture whose header cannot be read", () => {
    const broken = png(10, 10);
    broken.set([...text("XXXX")], 12);
    expect(() => sniff("a.png", broken)).toThrow(/could not be read/);
    expect(() => sniff("a.png", png(0, 10))).toThrow(/could not be read/);
  });
});

describe("a file's name", () => {
  it("keeps only the last part, with no control or direction characters", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(cleanFileName("evil\u202Efdp.exe")).toBe("evilfdp.exe");
    expect(cleanFileName('a\n"b".txt')).toBe("ab.txt");
    expect(cleanFileName(42)).toBe("file");
    expect(cleanFileName("x".repeat(500)).length).toBe(118);
  });
});
