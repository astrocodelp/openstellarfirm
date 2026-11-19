import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFolder,
  checkMailHost,
  checkPort,
  ImapClient,
  type ImapDeps,
  imapDate,
  MailError,
  parseInternalDate,
  quoted,
  type Server,
  tlsOptions,
} from "./imap";
import { FakeImap, type FakeMessage, internalDate } from "./imap-fake.testkit";

const server: Server = {
  host: "imap.example.com",
  port: 993,
  username: "me@example.com",
  ownNetwork: false,
};

const message = (uid: number, subject: string, extra = ""): FakeMessage => ({
  uid,
  flags: uid % 2 === 0 ? ["\\Seen"] : [],
  date: internalDate("2026-11-19T09:12:00Z"),
  raw: `From: Ann <ann@example.com>\r\nTo: me@example.com\r\nSubject: ${subject}\r\nDate: Thu, 19 Nov 2026 09:12:00 +0000\r\n${extra}\r\nHello ${subject}.\r\n`,
});

function client(
  fake: FakeImap,
  over: Partial<ImapDeps> = {},
  password = "app-password",
  s: Server = server,
) {
  return new ImapClient(s, async () => password, fake.deps(over));
}

describe("signing in and checking", () => {
  it("signs in, lists the folders (a literal name too) and signs out", async () => {
    const fake = new FakeImap({
      chunk: 7,
      folders: { INBOX: [], Sent: [], "Receipts & more": [] },
    });
    const found = await client(fake).check();
    expect(found.folders).toEqual(["INBOX", "Sent", "Receipts & more"]);
    expect(fake.commands.map((c) => c.split(" ")[1])).toEqual([
      "LOGIN",
      "LIST",
      "LOGOUT",
    ]);
  });

  it("says plainly that a sign-in was refused, and never repeats the password", async () => {
    const fake = new FakeImap({
      refusal: (password) => `bad login for password ${password}`,
    });
    const error = await client(fake, {}, "wrong-secret-123")
      .check()
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(MailError);
    const text = (error as Error).message;
    expect(text).toMatch(/did not accept the sign-in/);
    expect(text).not.toContain("wrong-secret-123");
    expect(text).not.toContain("bad login");
    expect(text).not.toContain("example.com");
  });

  it("sends a password with quotes and backslashes safely", async () => {
    const fake = new FakeImap({ password: 'a"b\\c d' });
    await client(fake, {}, 'a"b\\c d').check();
    expect(fake.commands[0]).toContain('"a\\"b\\\\c d"');
  });

  it("refuses a password it cannot send as plain text, without sending it", async () => {
    const fake = new FakeImap();
    await expect(client(fake, {}, "pässword").check()).rejects.toThrow(
      /plain letters/,
    );
    expect(fake.commands).toEqual([]);
    expect(() => quoted("a\r\nb")).toThrow(MailError);
  });

  it("stops when the greeting is not a welcome", async () => {
    const fake = new FakeImap({ greeting: "* BYE go away\r\n" });
    await expect(client(fake).check()).rejects.toThrow(/did not welcome/);
    const pre = new FakeImap({ greeting: "* PREAUTH hi\r\n" });
    await expect(client(pre).check()).rejects.toThrow(/did not welcome/);
  });
});

describe("TLS only and where it connects", () => {
  it("asks for a verified connection to the name that was typed", () => {
    expect(tlsOptions("imap.example.com", "93.184.216.34", 993)).toEqual({
      host: "93.184.216.34",
      port: 993,
      servername: "imap.example.com",
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
  });

  it("has no plain socket and no way to start TLS late", () => {
    const source = readFileSync(join(import.meta.dirname, "imap.ts"), "utf8");
    expect(source).toMatch(/from "node:tls"/);
    expect(source).not.toMatch(/createConnection|net\.connect|STARTTLS/i);
    // node:net is used only to tell a name from an address.
    const nets = source.match(/from "node:net"/g) ?? [];
    expect(nets).toHaveLength(1);
    expect(source).toMatch(/import \{ isIP \} from "node:net"/);
    expect(source).not.toMatch(/rejectUnauthorized:\s*false/);
  });

  it("connects to the checked address with the typed name, never another", async () => {
    const fake = new FakeImap();
    const seen: unknown[] = [];
    await client(fake, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      connect: async (to) => {
        seen.push(to);
        return fake.connect();
      },
    }).check();
    expect(seen).toEqual([
      { host: "imap.example.com", address: "93.184.216.34", port: 993 },
    ]);
  });

  it("refuses a name that resolves to a private address, unless the person said so", async () => {
    const fake = new FakeImap();
    let connected = false;
    const over: Partial<ImapDeps> = {
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.5", family: 4 },
      ],
      connect: async () => {
        connected = true;
        return fake.connect();
      },
    };
    await expect(client(fake, over).check()).rejects.toThrow(/private network/);
    expect(connected).toBe(false);
    for (const address of ["127.0.0.1", "10.0.0.2", "::1", "169.254.1.1"]) {
      await expect(
        client(fake, {
          ...over,
          resolve: async () => [{ address, family: 4 }],
        }).check(),
      ).rejects.toThrow(/private network/);
    }
    // Ticked: a name on the home network works, still over verified TLS.
    const home = new FakeImap();
    const result = await client(
      home,
      { resolve: async () => [{ address: "192.168.1.5", family: 4 }] },
      "app-password",
      { ...server, host: "nas.home.lan", ownNetwork: true },
    ).check();
    expect(result.folders).toEqual(["INBOX"]);
    // Even then, an address that is never a mail server is refused.
    await expect(
      client(
        home,
        { resolve: async () => [{ address: "0.0.0.0", family: 4 }] },
        "app-password",
        { ...server, ownNetwork: true },
      ).check(),
    ).rejects.toThrow(/mail server/);
  });

  it("says plainly when the name is not found, or the certificate is not trusted", async () => {
    const fake = new FakeImap();
    await expect(
      client(fake, {
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }).check(),
    ).rejects.toThrow(/could not be found/);
    await expect(
      client(fake, {
        connect: async () => {
          throw Object.assign(new Error("x"), {
            code: "DEPTH_ZERO_SELF_SIGNED_CERT",
          });
        },
      }).check(),
    ).rejects.toThrow(/certificate is not trusted/);
  });
});

describe("the host and the port", () => {
  it("takes a host name and nothing else", () => {
    expect(checkMailHost(" IMAP.Example.com. ", false)).toBe(
      "imap.example.com",
    );
    for (const bad of [
      "",
      "   ",
      "192.168.1.5",
      "[::1]",
      "127.0.0.1",
      "https://imap.example.com",
      "imap.example.com:993",
      "imap.example.com/x",
      "imap example.com",
      "user@imap.example.com",
      "-bad.example.com",
      "a..b.com",
      "localhost",
      "x".repeat(300),
      42,
      undefined,
    ]) {
      expect(() => checkMailHost(bad, false), String(bad)).toThrow(MailError);
    }
    // A name with no dot is for the person's own network only.
    expect(checkMailHost("nas", true)).toBe("nas");
    expect(() => checkMailHost("nas", false)).toThrow(/full name/);
    // An address is never allowed, even on the person's own network.
    expect(() => checkMailHost("192.168.1.5", true)).toThrow(/not an address/);
  });

  it("takes a port from 1 to 65535, 993 by default", () => {
    expect(checkPort(undefined)).toBe(993);
    expect(checkPort(143)).toBe(143);
    for (const bad of [0, 65536, 1.5, -1, "993", Number.NaN, null])
      expect(() => checkPort(bad)).toThrow(MailError);
  });

  it("takes only plain folder names", () => {
    expect(checkFolder(undefined)).toBe("INBOX");
    expect(checkFolder("inbox")).toBe("INBOX");
    expect(checkFolder("Work/2026")).toBe("Work/2026");
    for (const bad of ["a\r\nb", "é", "x".repeat(101), 5, {}]) {
      expect(() => checkFolder(bad)).toThrow(MailError);
    }
  });
});

describe("listing and reading", () => {
  const folders = () => ({
    INBOX: [
      message(1, "First"),
      message(2, "Second"),
      {
        ...message(3, "=?UTF-8?B?w4lnYWxl?="),
        date: internalDate("2026-11-19T10:00:00Z"),
      },
    ],
    Work: [message(9, "Elsewhere")],
  });

  it("lists recent messages with unread marks, split across tiny chunks", async () => {
    const fake = new FakeImap({ folders: folders(), chunk: 3 });
    const listing = await client(fake).list("INBOX", 2, false);
    expect(listing.validity).toBe("777");
    expect(listing.heads.map((h) => [h.uid, h.unread])).toEqual([
      [1, true],
      [2, false],
      [3, true],
    ]);
    expect(listing.heads[0]?.internalDate?.toISOString()).toBe(
      "2026-11-19T09:12:00.000Z",
    );
    expect(listing.heads[0]?.header.toString()).toContain("Subject: First");
    // The search names the date, a day early, and the unread filter when asked.
    const search = fake.commands.find((c) => c.includes("UID SEARCH"));
    expect(search).toMatch(/UID SEARCH SINCE 16-Nov-2026$/);
    const unread = new FakeImap({ folders: folders() });
    const only = await client(unread).list("INBOX", 2, true);
    expect(only.heads.map((h) => h.uid)).toEqual([1, 3]);
    expect(unread.commands.some((c) => c.includes("SEARCH UNSEEN SINCE"))).toBe(
      true,
    );
  });

  it("reads one message whole, and refuses when the mailbox was renumbered", async () => {
    const fake = new FakeImap({ folders: folders(), chunk: 1 });
    const raw = await client(fake).read("INBOX", 1, "777");
    expect(raw.toString()).toContain("Hello First.");
    await expect(client(fake).read("INBOX", 1, "999")).rejects.toThrow(
      /changed/,
    );
    await expect(client(fake).read("Nope", 1, "")).rejects.toThrow(
      /could not be opened/,
    );
    await expect(client(fake).read("INBOX", 404, "777")).rejects.toThrow(
      /not found/,
    );
    await expect(client(fake).read("INBOX", 0, "777")).rejects.toThrow(
      /not known/,
    );
  });

  it("reads a header the server sends as a quoted string, and a field after the literal", async () => {
    const fake = new FakeImap({
      folders: { INBOX: [message(1, "A")] },
      respond: (command, tag) => {
        if (command.startsWith("UID FETCH"))
          return `* 1 FETCH (UID 1 BODY[HEADER.FIELDS (FROM)] "From: x@y.z\\r\\n")\r\n* 2 FETCH (UID 1 BODY[HEADER.FIELDS (FROM)] {13}\r\nFrom: q@y.z\r\n FLAGS (\\Seen) INTERNALDATE "19-Nov-2026 09:12:00 +0000")\r\n${tag} OK Done\r\n`;
        return undefined;
      },
    });
    const listing = await client(fake).list("INBOX", 2, false);
    expect(listing.heads).toHaveLength(2);
    expect(listing.heads[1]?.unread).toBe(false);
    expect(listing.heads[1]?.header.toString()).toContain("q@y.z");
  });

  it("ignores a message the app did not ask for", async () => {
    const fake = new FakeImap({
      folders: { INBOX: [message(1, "A")] },
      respond: (command, tag) =>
        command.startsWith("UID FETCH")
          ? `* 1 FETCH (UID 99 FLAGS () BODY[HEADER.FIELDS (FROM)] {2}\r\nx\r\n)\r\n${tag} OK Done\r\n`
          : undefined,
    });
    expect((await client(fake).list("INBOX", 2, false)).heads).toEqual([]);
  });

  it("looks at the newest 100 when there are more", async () => {
    const many = Array.from({ length: 150 }, (_, i) => message(i + 1, `M${i}`));
    const fake = new FakeImap({ folders: { INBOX: many } });
    const listing = await client(fake).list("INBOX", 2, false);
    expect(listing.heads).toHaveLength(100);
    expect(Math.min(...listing.heads.map((h) => h.uid))).toBe(51);
  });

  it("parses the server's date, and the app's date for a search", () => {
    expect(parseInternalDate(" 5-Nov-2026 09:12:00 +0100")?.toISOString()).toBe(
      "2026-11-05T08:12:00.000Z",
    );
    expect(parseInternalDate("nonsense")).toBeUndefined();
    expect(imapDate(new Date("2026-03-05T00:00:00Z"))).toBe("5-Mar-2026");
  });
});

describe("a command that only looks", () => {
  const FORBIDDEN =
    /\b(STORE|COPY|MOVE|EXPUNGE|APPEND|DELETE|CREATE|RENAME|SELECT|UNSELECT|CLOSE|IDLE|STARTTLS|AUTHENTICATE|SUBSCRIBE|UNSUBSCRIBE|SETACL|SETQUOTA|NAMESPACE)\b/;

  /** A command with its quoted strings taken out, so a folder's name is not a verb. */
  const bare = (line: string) => line.replace(/"(?:[^"\\]|\\.)*"/g, '""');

  it("uses EXAMINE and BODY.PEEK, and only the six allowed commands", async () => {
    const fake = new FakeImap({
      folders: {
        INBOX: [message(1, "A"), message(2, "B")],
        // A folder named like a command is only ever a quoted name.
        DELETE: [message(5, "C")],
        "STORE 1 +FLAGS": [message(6, "D")],
      },
      chunk: 11,
    });
    const c = client(fake);
    await c.check();
    await c.list("INBOX", 3, true);
    await c.list("DELETE", 3, false);
    const listing = await c.list("STORE 1 +FLAGS", 3, false);
    await c.read("INBOX", 1, "777");
    await c.read("DELETE", 5, "777");
    expect(listing.heads).toHaveLength(1);
    expect(fake.commands.length).toBeGreaterThan(10);
    for (const line of fake.commands) {
      const command = line.slice(line.indexOf(" ") + 1);
      expect(command, line).toMatch(
        /^(LOGIN "|LIST "" "\*"$|EXAMINE "|UID SEARCH |UID FETCH |LOGOUT$)/,
      );
      expect(bare(command), line).not.toMatch(FORBIDDEN);
      // Any body is fetched with PEEK, which leaves the message unread.
      expect(command, line).not.toMatch(/BODY(?!\.PEEK)/);
    }
    expect(fake.commands.some((l) => /EXAMINE/.test(l))).toBe(true);
    expect(fake.written).not.toMatch(/\bSELECT\b/);
  });

  it("makes no command from a hostile folder name, and connects to nothing for a bad one", async () => {
    const fake = new FakeImap();
    let connected = false;
    const c = client(fake, {
      connect: async () => {
        connected = true;
        return fake.connect();
      },
    });
    for (const folder of [
      "INBOX\r\nx DELETE 1",
      "a\nb",
      "é",
      "x".repeat(101),
    ]) {
      await expect(c.list(folder, 2, false)).rejects.toThrow(MailError);
      await expect(c.read(folder, 1, "")).rejects.toThrow(MailError);
    }
    expect(connected).toBe(false);
    expect(fake.commands).toEqual([]);
    // A name with quotes is sent escaped, as one string, on one line.
    await c.list('a" DELETE "b\\', 2, false).catch(() => undefined);
    const examine = fake.commands.find((l) => l.includes("EXAMINE"));
    expect(examine).toBe('a2 EXAMINE "a\\" DELETE \\"b\\\\"');
    expect(fake.commands.every((l) => /^a\d+ [A-Z]/.test(l))).toBe(true);
    expect(fake.commands).toHaveLength(2);
  });

  it("holds in its own source: no forbidden command word and no bare BODY[", () => {
    const source = readFileSync(join(import.meta.dirname, "imap.ts"), "utf8")
      // Comments may name what the client cannot do.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toMatch(FORBIDDEN);
    expect(source).not.toMatch(/BODY\[/);
    expect(source).toMatch(/BODY\\\.PEEK/);
    // One place writes to the connection, and it checks the shape first.
    expect(source.match(/stream\.write\(/g) ?? []).toHaveLength(1);
    const mailSource = readFileSync(
      join(import.meta.dirname, "mail.ts"),
      "utf8",
    );
    expect(mailSource).not.toMatch(/smtp|nodemailer|sendMail/i);
  });
});

describe("a hostile server", () => {
  it("stops at a literal that is too big, without waiting for it", async () => {
    const fake = new FakeImap({
      respond: (command) =>
        command.startsWith("LIST") ? '* LIST () "/" {99999999}\r\n' : undefined,
    });
    await expect(client(fake).check()).rejects.toThrow(/too much/);
  });

  it("stops at endless output, at the cap", async () => {
    const fake = new FakeImap({
      respond: (command, tag) =>
        command.startsWith("LIST")
          ? `${`* NOISE ${"x".repeat(60_000)}\r\n`.repeat(120)}${tag} OK late\r\n`
          : undefined,
    });
    await expect(client(fake).check()).rejects.toThrow(/too much/);
  });

  it("stops at a line that never ends", async () => {
    const fake = new FakeImap({
      respond: (command) =>
        command.startsWith("LIST") ? "x".repeat(100_000) : undefined,
    });
    await expect(client(fake).check()).rejects.toThrow(/too long|too much/);
  });

  it("ignores unknown untagged data, and ends on a hang up or a request for more input", async () => {
    const noisy = new FakeImap({
      respond: (command, tag) =>
        command.startsWith("LIST")
          ? `* WHATEVER 1 2 3\r\n* 5 EXISTS\r\n* LIST (\\X) "/" "INBOX"\r\n${tag} OK ok\r\n`
          : undefined,
    });
    expect((await client(noisy).check()).folders).toEqual(["INBOX"]);
    const bye = new FakeImap({
      respond: (command) =>
        command.startsWith("LIST") ? "* BYE shutting down\r\n" : undefined,
    });
    await expect(client(bye).check()).rejects.toThrow(/ended the session/);
    const more = new FakeImap({
      respond: (command) =>
        command.startsWith("LIST") ? "+ send me more\r\n" : undefined,
    });
    await expect(client(more).check()).rejects.toThrow(/did not expect/);
    const loginMore = new FakeImap({
      respond: (command) =>
        command.startsWith("LOGIN") ? "+ password?\r\n" : undefined,
    });
    await expect(client(loginMore).check()).rejects.toThrow(/did not expect/);
    // Nothing the client wrote answers a request for more input.
    expect(loginMore.commands).toHaveLength(1);
  });

  it("stops on an answer for another command", async () => {
    const fake = new FakeImap({
      respond: (command) =>
        command.startsWith("LIST") ? "a99 OK sneaky\r\n" : undefined,
    });
    await expect(client(fake).check()).rejects.toThrow(/did not expect/);
  });

  it("stops when the server goes quiet for 30 seconds (here, a short wait)", async () => {
    const fake = new FakeImap({ silentOn: "LIST" });
    const started = Date.now();
    await expect(client(fake, { timeoutMs: 60 }).check()).rejects.toThrow(
      /too long to answer/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    const slowGreeting = new FakeImap({ greeting: "" });
    await expect(
      client(slowGreeting, { timeoutMs: 60 }).check(),
    ).rejects.toThrow(/too long to answer/);
  });

  it("uses 30 seconds and 5 MB by default", async () => {
    const source = readFileSync(join(import.meta.dirname, "imap.ts"), "utf8");
    expect(source).toMatch(/COMMAND_TIMEOUT_MS = 30_000/);
    expect(source).toMatch(/MAX_RESPONSE_BYTES = 5 \* 1024 \* 1024/);
  });

  it("stops when the connection is dropped, or the answer is stopped by the person", async () => {
    const drop = new FakeImap({
      respond: (command) => (command.startsWith("LIST") ? "* LI" : undefined),
    });
    const stream = drop.deps().connect;
    await expect(
      client(drop, {
        connect: async (to) => {
          const s = await stream(to);
          setTimeout(() => s.destroy(), 30);
          return s;
        },
      }).check(),
    ).rejects.toThrow(MailError);
    const controller = new AbortController();
    const fake = new FakeImap({ silentOn: "LIST" });
    const pending = new ImapClient(
      server,
      async () => "app-password",
      fake.deps(),
      controller.signal,
    ).check();
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow(/Stopped/);
  });
});
