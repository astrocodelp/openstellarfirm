import { createSocket, type Socket } from "node:dgram";

/**
 * The app's one mDNS answer: `osf-<label>.local`, with this computer's private
 * addresses. It answers A and AAAA questions for exactly that name and
 * nothing else, and advertises nothing (no announcement on start, no service
 * records, no reverse names). A false answer from another device cannot fool a
 * pet, since the pet pins the certificate and not the name. The DNS message
 * reader and writer are our own, for just this.
 */

export const MDNS_PORT = 5353;
export const MDNS_GROUP_V4 = "224.0.0.251";
export const MDNS_GROUP_V6 = "ff02::fb";
export const MDNS_TTL_SECONDS = 120;

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_ANY = 255;
const CLASS_IN = 1;
const CACHE_FLUSH = 0x8000;

export interface DnsQuestion {
  readonly name: string;
  readonly type: number;
  readonly cls: number;
  /** The unicast-response bit of an mDNS question. */
  readonly unicast: boolean;
}

export interface DnsQuery {
  readonly id: number;
  readonly questions: readonly DnsQuestion[];
}

function readName(
  packet: Buffer,
  start: number,
): { name: string; end: number } | null {
  const labels: string[] = [];
  let at = start;
  let end = -1;
  for (let jumps = 0; jumps < 16; ) {
    const length = packet[at];
    if (length === undefined) return null;
    if (length === 0) {
      return { name: labels.join("."), end: end < 0 ? at + 1 : end };
    }
    if ((length & 0xc0) === 0xc0) {
      const low = packet[at + 1];
      if (low === undefined) return null;
      if (end < 0) end = at + 2;
      at = ((length & 0x3f) << 8) | low;
      jumps += 1;
      continue;
    }
    if ((length & 0xc0) !== 0 || at + 1 + length > packet.length) return null;
    labels.push(packet.toString("latin1", at + 1, at + 1 + length));
    if (labels.join(".").length > 253) return null;
    at += 1 + length;
  }
  return null;
}

/**
 * Reads a DNS query: null for anything that is not a plain question packet
 * (a response, another opcode, a short or broken packet).
 */
export function parseQuery(packet: Buffer): DnsQuery | null {
  if (packet.length < 12) return null;
  const flags = packet.readUInt16BE(2);
  if ((flags & 0x8000) !== 0 || ((flags >> 11) & 0xf) !== 0) return null;
  const count = packet.readUInt16BE(4);
  if (count === 0 || count > 16) return null;
  const questions: DnsQuestion[] = [];
  let at = 12;
  for (let i = 0; i < count; i += 1) {
    const read = readName(packet, at);
    if (!read || read.end + 4 > packet.length) return null;
    const type = packet.readUInt16BE(read.end);
    const rawClass = packet.readUInt16BE(read.end + 2);
    questions.push({
      name: read.name,
      type,
      cls: rawClass & 0x7fff,
      unicast: (rawClass & 0x8000) !== 0,
    });
    at = read.end + 4;
  }
  return { id: packet.readUInt16BE(0), questions };
}

function writeName(name: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of name.split(".")) {
    const bytes = Buffer.from(label, "latin1");
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function ipv4Bytes(address: string): Buffer | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((p) => Number.isInteger(p) && p >= 0 && p < 256)
    ? Buffer.from(parts)
    : null;
}

function ipv6Bytes(address: string): Buffer | null {
  const text = address.split("%")[0] ?? "";
  if (!/^[0-9a-fA-F:]+$/.test(text) || (text.match(/::/g) ?? []).length > 1)
    return null;
  const [head = "", tail] = text.split("::");
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const a = groups(head);
  const b = tail === undefined ? [] : groups(tail);
  const zeros = tail === undefined ? 0 : 8 - a.length - b.length;
  const all = [...a, ...new Array<string>(Math.max(zeros, 0)).fill("0"), ...b];
  if (all.length !== 8) return null;
  const out = Buffer.alloc(16);
  for (const [i, group] of all.entries()) {
    if (group.length > 4) return null;
    out.writeUInt16BE(Number.parseInt(group, 16), i * 2);
  }
  return out;
}

function record(name: Buffer, type: number, data: Buffer): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(CLASS_IN | CACHE_FLUSH, 2);
  head.writeUInt32BE(MDNS_TTL_SECONDS, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([name, head, data]);
}

/**
 * The response packet: an authoritative answer with id 0 (as multicast
 * responses have) and one record per address of the kind asked for. Empty
 * when there is nothing to say.
 */
export function buildResponse(
  name: string,
  wantA: boolean,
  wantAaaa: boolean,
  addresses: readonly string[],
): Buffer | null {
  const owner = writeName(name);
  const records: Buffer[] = [];
  for (const address of addresses) {
    const v4 = wantA ? ipv4Bytes(address) : null;
    if (v4) records.push(record(owner, TYPE_A, v4));
    const v6 = wantAaaa && !v4 ? ipv6Bytes(address) : null;
    if (v6) records.push(record(owner, TYPE_AAAA, v6));
  }
  if (records.length === 0) return null;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2); // response, authoritative
  header.writeUInt16BE(records.length, 6);
  return Buffer.concat([header, ...records]);
}

export interface MdnsDeps {
  /** The random label: the name answered is `osf-<label>.local`. */
  readonly label: string;
  /** The computer's private addresses now, asked for on every question. */
  readonly addresses: () => readonly string[];
  /** Makes a UDP socket; tests hand in a fake one. */
  readonly createSocket?: (type: "udp4" | "udp6") => Socket;
  /** Where a failure goes, in plain words; never a packet. */
  readonly onProblem?: (message: string) => void;
}

export function mdnsNameOf(label: string): string {
  return `osf-${label}.local`;
}

export class MdnsResponder {
  private sockets: Socket[] = [];
  readonly name: string;

  constructor(private readonly deps: MdnsDeps) {
    this.name = mdnsNameOf(deps.label);
  }

  /** What to send back for this packet, or null to stay quiet. */
  answer(packet: Buffer): Buffer | null {
    const query = parseQuery(packet);
    if (!query) return null;
    let wantA = false;
    let wantAaaa = false;
    for (const q of query.questions) {
      if (q.cls !== CLASS_IN && q.cls !== 255) continue;
      if (q.name.toLowerCase() !== this.name) continue;
      if (q.type === TYPE_A || q.type === TYPE_ANY) wantA = true;
      if (q.type === TYPE_AAAA || q.type === TYPE_ANY) wantAaaa = true;
    }
    if (!wantA && !wantAaaa) return null;
    return buildResponse(this.name, wantA, wantAaaa, this.deps.addresses());
  }

  get listening(): boolean {
    return this.sockets.length > 0;
  }

  /** Opens the sockets. The IPv4 one must work; the IPv6 one is a bonus. */
  async start(): Promise<void> {
    if (this.sockets.length > 0) return;
    const make =
      this.deps.createSocket ??
      ((type) => createSocket({ type, reuseAddr: true }));
    const v4 = make("udp4");
    try {
      await this.open(v4, "udp4");
    } catch (error) {
      v4.close();
      throw error;
    }
    this.sockets.push(v4);
    const v6 = make("udp6");
    try {
      await this.open(v6, "udp6");
      this.sockets.push(v6);
    } catch {
      // Many computers have no IPv6 multicast: the pet asks for A records.
      try {
        v6.close();
      } catch {
        // Already closed.
      }
    }
  }

  private open(socket: Socket, type: "udp4" | "udp6"): Promise<void> {
    return new Promise((resolve, reject) => {
      const group = type === "udp4" ? MDNS_GROUP_V4 : MDNS_GROUP_V6;
      socket.once("error", reject);
      socket.on("message", (message, remote) => {
        const response = this.answer(message);
        if (!response) return;
        // Questions from a port other than 5353 ask for a plain answer (RFC
        // 6762 section 6.7): echo the id and send it straight back. Anything
        // else is answered on the group, as a multicast response.
        const direct = remote.port !== MDNS_PORT;
        if (direct) {
          const query = parseQuery(message);
          if (query) response.writeUInt16BE(query.id, 0);
        }
        socket.send(
          response,
          direct ? remote.port : MDNS_PORT,
          direct ? remote.address : group,
          (error) => {
            if (error)
              this.deps.onProblem?.("The desk pet name answer was not sent.");
          },
        );
      });
      socket.bind(MDNS_PORT, () => {
        try {
          socket.addMembership(group);
          socket.setMulticastTTL(255);
          socket.removeListener("error", reject);
          socket.on("error", () =>
            this.deps.onProblem?.(
              "The desk pet name answer had a network problem.",
            ),
          );
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  stop(): void {
    for (const socket of this.sockets) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
    this.sockets = [];
  }
}
