import { describe, expect, it } from "vitest";
import {
  decodeCharset,
  decodeQuotedPrintable,
  decodeWords,
  parseHeaders,
  parseMessage,
  parseParams,
  readHeaders,
} from "./mime";

const crlf = (text: string) =>
  Buffer.from(text.replace(/\n/g, "\r\n"), "latin1");

describe("headers", () => {
  it("decodes RFC 2047 words in every form", () => {
    expect(decodeWords("=?UTF-8?B?w4lnYWxl?=")).toBe("Égale");
    expect(decodeWords("=?utf-8?Q?Caf=C3=A9_au_lait?=")).toBe("Café au lait");
    expect(decodeWords("=?iso-8859-1?Q?Andr=E9?= <a@b.c>")).toBe(
      "André <a@b.c>",
    );
    // Greek, in the charset it is often still sent in.
    expect(decodeWords("=?iso-8859-7?B?4+Xp4Q==?=")).toBe("γεια");
    // Words next to each other join with no space between them.
    expect(decodeWords("=?utf-8?Q?a?= =?utf-8?Q?b?=")).toBe("ab");
    // Nonsense is left as it is, and an unknown charset reads as UTF-8.
    expect(decodeWords("=?nope?X?zz?=")).toBe("=?nope?X?zz?=");
    expect(decodeWords("=?no-such-set?Q?ok?=")).toBe("ok");
  });

  it("unfolds a header and keeps the first of a repeated one", () => {
    const headers = parseHeaders(
      "Subject: one\r\n two\r\nsubject: again\r\nX-Bad Name: no\r\nFrom: a@b.c",
    );
    expect(headers.get("subject")).toBe("one two");
    expect(headers.get("from")).toBe("a@b.c");
    expect(headers.has("x-bad name")).toBe(false);
  });

  it("puts a header on one clean line", () => {
    const h = readHeaders(
      "From: =?utf-8?B?w4k=?= <a@b.c>\r\nSubject: hi\u0007 there\r\n",
    );
    expect(h.from).toBe("É <a@b.c>");
    expect(h.subject).toBe("hi there");
  });

  it("reads parameters, quoted ones and RFC 2231 ones", () => {
    const p = parseParams(
      "multipart/mixed; boundary=\"a;b\"; charset=ISO-8859-1; filename*=utf-8''caf%C3%A9.txt",
    );
    expect(p.type).toBe("multipart/mixed");
    expect(p.params.boundary).toBe("a;b");
    expect(p.params.charset).toBe("ISO-8859-1");
    expect(p.params.filename).toBe("café.txt");
    const split = parseParams(
      "attachment; filename*0*=utf-8''a%20; filename*1=b.pdf",
    );
    expect(split.params.filename).toBe("a b.pdf");
  });
});

describe("bodies", () => {
  it("decodes quoted-printable, including soft breaks and a bad escape", () => {
    expect(
      decodeQuotedPrintable("caf=C3=A9 so=\r\nft =ZZ").toString("utf8"),
    ).toBe("café soft =ZZ");
  });

  it("decodes the charsets people really send", () => {
    expect(decodeCharset(Buffer.from([0xe9]), "iso-8859-1")).toBe("é");
    expect(
      decodeCharset(Buffer.from([0xe3, 0xe5, 0xe9, 0xe1]), "ISO-8859-7"),
    ).toBe("γεια");
    expect(decodeCharset(Buffer.from("é"), "utf-8")).toBe("é");
    expect(decodeCharset(Buffer.from("ok"), "x-unknown")).toBe("ok");
    expect(decodeCharset(Buffer.from("ok"), undefined)).toBe("ok");
  });

  it("reads a plain message with a quoted-printable body in iso-8859-1", () => {
    const mail = parseMessage(
      crlf(
        "From: a@b.c\nSubject: Caf=?utf-8?Q?=C3=A9?=\nContent-Type: text/plain; charset=iso-8859-1\nContent-Transfer-Encoding: quoted-printable\n\nCaf=E9 menu=\n card\n",
      ),
    );
    expect(mail.text).toBe("Café menu card");
    expect(mail.subject).toBe("Café");
    expect(mail.attachments).toEqual([]);
  });

  it("reads a base64 body in utf-8 and in iso-8859-7", () => {
    const utf = parseMessage(
      crlf(
        `Content-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${Buffer.from("Καλημέρα").toString("base64")}\n`,
      ),
    );
    expect(utf.text).toBe("Καλημέρα");
    const greek = parseMessage(
      crlf(
        `Content-Type: text/plain; charset=iso-8859-7\nContent-Transfer-Encoding: base64\n\n${Buffer.from([0xe3, 0xe5, 0xe9, 0xe1]).toString("base64")}\n`,
      ),
    );
    expect(greek.text).toBe("γεια");
  });

  it("prefers the plain part of an alternative, and names attachments without opening them", () => {
    const mail = parseMessage(
      crlf(
        [
          "From: Ann <ann@example.com>",
          "To: me@example.com",
          "Subject: Report",
          'Content-Type: multipart/mixed; boundary="OUT"',
          "",
          "preamble",
          "--OUT",
          'Content-Type: multipart/alternative; boundary="IN"',
          "",
          "--IN",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "The plain text.",
          "--IN",
          "Content-Type: text/html; charset=utf-8",
          "",
          "<p>The <b>html</b> text.</p>",
          "--IN--",
          "--OUT",
          'Content-Type: application/pdf; name="report.pdf"',
          'Content-Disposition: attachment; filename="report.pdf"',
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from("%PDF-1.4 secret bytes").toString("base64"),
          "--OUT",
          "Content-Type: image/png",
          "Content-ID: <x>",
          "",
          "xx",
          "--OUT--",
          "epilogue",
          "",
        ].join("\n"),
      ),
    );
    expect(mail.text).toBe("The plain text.");
    expect(mail.text).not.toContain("secret");
    expect(mail.attachments.map((a) => [a.name, a.type])).toEqual([
      ["report.pdf", "application/pdf"],
      ["unnamed image/png", "image/png"],
    ]);
    expect(mail.attachments[0]?.size).toBe("%PDF-1.4 secret bytes".length);
    expect(mail.from).toBe("Ann <ann@example.com>");
  });

  it("turns an HTML-only message into plain text and never keeps scripts or links", () => {
    const mail = parseMessage(
      crlf(
        'Content-Type: text/html; charset=utf-8\n\n<html><head><title>Hi</title><style>p{}</style></head><body><script>alert(1)</script><p>Hello <a href="https://evil.example/x">there</a>&amp; welcome</p><img src="https://evil.example/pixel.gif"></body></html>\n',
      ),
    );
    expect(mail.text).toContain("Hello there & welcome");
    expect(mail.text).not.toContain("alert");
    expect(mail.text).not.toContain("evil.example");
    expect(mail.text).not.toContain("<");
  });

  it("copes with a message cut short, a bad boundary and a deep nest", () => {
    const cut = parseMessage(
      crlf(
        'Content-Type: multipart/mixed; boundary="B"\n\n--B\nContent-Type: text/plain\n\nFirst part\n--B\nContent-Type: text/plain\n\nSecond, cut off',
      ),
    );
    expect(cut.text).toBe("First part\n\nSecond, cut off");
    const bad = parseMessage(
      crlf('Content-Type: multipart/mixed; boundary="a b<>"\n\nbody\n'),
    );
    expect(bad.text).toBe("");
    let nested = "Content-Type: text/plain\n\ndeep\n";
    for (let i = 0; i < 12; i += 1)
      nested = `Content-Type: multipart/mixed; boundary="b${i}"\n\n--b${i}\n${nested}\n--b${i}--\n`;
    expect(parseMessage(crlf(nested)).text.length).toBeLessThan(100);
  });

  it("cuts a long text at 200 KB and says so, and drops control characters", () => {
    const mail = parseMessage(
      Buffer.from(
        `Content-Type: text/plain\r\n\r\nhi\u0007${"x".repeat(250_000)}`,
        "latin1",
      ),
    );
    expect(mail.text.length).toBe(200_000);
    expect(mail.truncated).toBe(true);
    expect(mail.text.startsWith("hix")).toBe(true);
  });

  it("limits the number of parts", () => {
    let body = 'Content-Type: multipart/mixed; boundary="B"\n\n';
    for (let i = 0; i < 300; i += 1)
      body += `--B\nContent-Type: text/plain\n\np${i}\n`;
    body += "--B--\n";
    const mail = parseMessage(crlf(body));
    expect(mail.text.split("\n\n").length).toBeLessThanOrEqual(100);
  });
});
