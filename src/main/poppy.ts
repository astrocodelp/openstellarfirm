import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { CompanyOffer } from "../shared/types";
import { plain } from "./mcp";
import { isPublicAddress, USER_AGENT } from "./web";

/**
 * Looks up what a company publishes for people's AI agents, at
 * `https://<domain>/.well-known/poppy.json` (the Personal Agent Protocol).
 *
 * It only reads. It signs in to nothing, saves nothing and sends nothing from
 * the file to a model. The read is as careful as a web page read: https on
 * 443, the name resolved first, every address public, the connection made to
 * the checked address, no redirect followed at all, no cookie and no key.
 * Everything in the file is outside text: it is checked, cleaned and cut.
 */

export class PoppyError extends Error {}

const MAX_BYTES = 256 * 1024;
const DEADLINE_MS = 10_000;
const MAX_APIS = 20;
const MAX_SCANNED = 200;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 200;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export interface PoppyDeps {
  resolve(host: string): Promise<{ address: string; family: number }[]>;
  get(
    url: URL,
    to: { address: string; family: number },
  ): Promise<{ status: number; body: string }>;
}

/** A host name only: no scheme, path, port, sign-in or address. Returns it in lower case. */
export function checkDomain(raw: unknown): string {
  const bad = new PoppyError(
    "Type a site name only, such as example.com. No https://, path, port or address.",
  );
  if (typeof raw !== "string") throw bad;
  const host = raw.trim().toLowerCase();
  if (host.length < 4 || host.length > 253) throw bad;
  if (isIP(host) || isIP(host.replace(/^\[|\]$/g, ""))) throw bad;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)))
    throw bad;
  const last = labels[labels.length - 1] ?? "";
  if (/^\d+$/.test(last)) throw bad;
  if (["localhost", "local", "internal", "localdomain", "home"].includes(last))
    throw bad;
  return host;
}

/** An https address that could be a public service: a name, no sign-in, no query. */
function cleanApiUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 2000) return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  try {
    checkDomain(url.hostname);
  } catch {
    return undefined;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Reads the file strictly. Anything that does not fit is refused or left out. */
export function parsePoppy(text: string, domain: string): CompanyOffer {
  if (Buffer.byteLength(text) > MAX_BYTES)
    throw new PoppyError("That file is too large to read.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PoppyError("That site's file is not readable.");
  }
  const file = isObject(value) ? value : undefined;
  if (file?.protocol_version !== "1.0")
    throw new PoppyError(
      "That file is not a version this app understands (it reads 1.0).",
    );
  const org = isObject(file.organization) ? file.organization : undefined;
  if (
    !org ||
    typeof org.domain !== "string" ||
    org.domain.trim().toLowerCase() !== domain
  )
    throw new PoppyError(
      "That file names a different site than the one asked for, so it is not shown.",
    );
  const auth = isObject(file.auth) ? file.auth : undefined;
  const apis: CompanyOffer["apis"] = [];
  const list = Array.isArray(file.apis) ? file.apis.slice(0, MAX_SCANNED) : [];
  for (const item of list) {
    if (apis.length >= MAX_APIS) break;
    if (!isObject(item) || (item.type !== "mcp" && item.type !== "openapi"))
      continue;
    const url = cleanApiUrl(item.url);
    if (!url) continue;
    apis.push({
      type: item.type,
      url,
      description: plain(item.description, MAX_DESCRIPTION),
    });
  }
  return {
    domain,
    name: plain(org.name, MAX_NAME) || domain,
    signIn: auth !== undefined && auth.disabled !== true,
    apis,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The whole lookup. `rawDomain` is what the person typed. */
export async function lookupCompany(
  rawDomain: unknown,
  deps: PoppyDeps = nodeDeps,
): Promise<CompanyOffer> {
  const domain = checkDomain(rawDomain);
  const url = new URL(`https://${domain}/.well-known/poppy.json`);
  let addresses: { address: string; family: number }[];
  try {
    addresses = await deps.resolve(domain);
  } catch {
    throw new PoppyError(`${domain} could not be found.`);
  }
  const to = addresses[0];
  if (!to || !addresses.every((entry) => isPublicAddress(entry.address)))
    throw new PoppyError(
      "That name does not lead to a public website, so it is not read.",
    );
  let answer: Awaited<ReturnType<PoppyDeps["get"]>>;
  try {
    answer = await deps.get(url, to);
  } catch (error) {
    throw error instanceof PoppyError
      ? error
      : new PoppyError(`${domain} could not be reached.`);
  }
  if (answer.status >= 300 && answer.status < 400)
    throw new PoppyError(
      "That site sends the reader elsewhere. It is not followed.",
    );
  if (answer.status === 404)
    throw new PoppyError(
      `${domain} does not publish anything for personal agents.`,
    );
  if (answer.status < 200 || answer.status >= 300)
    throw new PoppyError(`The site answered with an error (${answer.status}).`);
  return parsePoppy(answer.body, domain);
}

/** The real network: Node's resolver and https, nothing followed, no cookie. */
export const nodeDeps: PoppyDeps = {
  resolve: (host) => dnsLookup(host, { all: true }),
  get: (url, to) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: url.hostname,
          servername: url.hostname,
          port: 443,
          path: url.pathname,
          method: "GET",
          timeout: DEADLINE_MS,
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
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
              req.destroy(new PoppyError("That file is too large to read."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            clearTimeout(whole);
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );
      // A slow trickle of bytes never resets this: the whole read has 10 seconds.
      const whole = setTimeout(
        () => req.destroy(new PoppyError(`${url.hostname} took too long.`)),
        DEADLINE_MS,
      );
      req.on("timeout", () =>
        req.destroy(new PoppyError(`${url.hostname} took too long.`)),
      );
      req.on("error", (error) => {
        clearTimeout(whole);
        reject(error);
      });
      req.end();
    }),
};
