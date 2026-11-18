import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * Reading a public web page, for an assistant.
 *
 * It is https only, on the standard port, to public addresses only: the name
 * is resolved first, every address it resolves to must be public, and the
 * connection is then made to that checked address, so a name cannot point the
 * app at this computer or the home network. A redirect to another site is not
 * followed; the assistant has to ask for that site by itself.
 */

export class WebError extends Error {}

const MAX_BYTES = 600 * 1024;
const MAX_CHARS = 20_000;
const TIMEOUT_MS = 15_000;
const MAX_HOPS = 3;

export interface WebDeps {
  resolve(host: string): Promise<{ address: string; family: number }[]>;
  get(
    url: URL,
    to: { address: string; family: number },
  ): Promise<{ status: number; location?: string; type: string; body: string }>;
}

/** Checks an address a model wrote before anything is asked or sent. */
export function checkWebAddress(raw: unknown): URL {
  if (typeof raw !== "string") throw new WebError("Give the page's address.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebError("That is not a web address.");
  }
  if (url.protocol !== "https:")
    throw new WebError("Only https addresses can be read.");
  if (url.username || url.password)
    throw new WebError("An address with a sign-in in it is not read.");
  if (url.port && url.port !== "443")
    throw new WebError("Only the standard https port can be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    isIP(host) ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new WebError("Only public websites can be read, by their name.");
  }
  url.hash = "";
  return url;
}

function publicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a = 0, b = 0] = parts;
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return publicV4(address);
  if (kind !== 6) return false;
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return publicV4(mapped[1]);
  // Everything under "::" (this computer, unspecified, the mapped and the old
  // compatible forms), unique local (fc00::/7), link local (fe80::/10),
  // multicast (ff00::/8), and the ranges that wrap an IPv4 address or are for
  // documentation: NAT64, 6to4, Teredo.
  if (
    /^(::|f[c-f]|fe[89ab]|64:ff9b:|2001:db8:|2001:0{0,4}:|2002:)/.test(lower)
  ) {
    return false;
  }
  return true;
}

function sameSite(a: string, b: string): boolean {
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return bare(a) === bare(b);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Turns a page into plain text. Scripts and styles are dropped, never run. */
export function htmlToText(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(
      /<\/(p|div|section|article|li|tr|h[1-6]|br|ul|ol|table|header|footer)\s*>/gi,
      "\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const decoded = `${title ? `${title}\n\n` : ""}${body}`
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff)),
    )
    .replace(
      /&([a-z]+);/gi,
      (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole,
    );
  return decoded
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reads one page as text. `raw` must already have passed `checkWebAddress`. */
export async function readWebPage(
  raw: string,
  deps: WebDeps = nodeDeps,
): Promise<string> {
  let url = checkWebAddress(raw);
  const first = url.hostname;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await deps.resolve(url.hostname);
    } catch {
      throw new WebError(`${url.hostname} could not be found.`);
    }
    const to = addresses[0];
    if (!to || !addresses.every((entry) => isPublicAddress(entry.address))) {
      throw new WebError(
        "That name does not lead to a public website, so it is not read.",
      );
    }
    let answer: Awaited<ReturnType<WebDeps["get"]>>;
    try {
      answer = await deps.get(url, to);
    } catch (error) {
      throw error instanceof WebError
        ? error
        : new WebError(`${url.hostname} could not be reached.`);
    }
    if (answer.status >= 300 && answer.status < 400 && answer.location) {
      let next: URL;
      try {
        next = checkWebAddress(new URL(answer.location, url).href);
      } catch {
        throw new WebError(
          "The page sends the reader somewhere that cannot be read.",
        );
      }
      if (!sameSite(next.hostname, first)) {
        throw new WebError(
          `The page sends the reader to another site, ${next.hostname}. Ask to read that address if it is needed.`,
        );
      }
      url = next;
      continue;
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new WebError(`The site answered with an error (${answer.status}).`);
    }
    if (!/^(text\/|application\/(json|xhtml\+xml|xml))/i.test(answer.type)) {
      throw new WebError(
        "That address is not a page of text, so it cannot be read here.",
      );
    }
    const text = /html|xml/i.test(answer.type)
      ? htmlToText(answer.body)
      : answer.body.trim();
    if (!text) return "The page has no text to read.";
    return text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS)}\n(The page goes on; only the first part is shown.)`
      : text;
  }
  throw new WebError(
    "The page kept sending the reader on, so it was not read.",
  );
}

/** The real network: Node's own resolver and https, with nothing followed. */
export const nodeDeps: WebDeps = {
  resolve: (host) => dnsLookup(host, { all: true }),
  get: (url, to) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: url.hostname,
          servername: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          timeout: TIMEOUT_MS,
          headers: {
            "user-agent":
              "StellarFirm-Open (+https://github.com/astrocodelp/worker-bot-open-source)",
            accept: "text/html,text/plain,application/json;q=0.9",
          },
          // Connect to the address that was checked, whatever the name says now.
          lookup: (_host, options, done) => {
            const callback = done as (
              error: Error | null,
              address: string | { address: string; family: number }[],
              family?: number,
            ) => void;
            if (typeof options === "object" && options.all)
              callback(null, [to]);
            else callback(null, to.address, to.family);
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > MAX_BYTES) {
              req.destroy(new WebError("That page is too large to read here."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const location = response.headers.location;
            resolve({
              status: response.statusCode ?? 0,
              ...(location ? { location } : {}),
              type: response.headers["content-type"] ?? "",
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );
      req.on("timeout", () =>
        req.destroy(new WebError(`${url.hostname} took too long to answer.`)),
      );
      req.on("error", reject);
      req.end();
    }),
};
