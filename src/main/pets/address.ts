import { isIP } from "node:net";

/**
 * Whether an address is one a desk pet may call from: this computer or a
 * private network (10/8, 172.16/12, 192.168/16, link-local 169.254/16, and for
 * IPv6 ::1, fc00::/7 and fe80::/10). The server drops every other connection
 * at the socket, before any TLS or HTTP is read. An address that is not an IP
 * address at all is refused. `web.ts` asks the opposite question (is this a
 * public address) for pages the assistants read, so the two are kept apart.
 */

function privateV4(parts: readonly number[]): boolean {
  const [a = 0, b = 0] = parts;
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Eight 16-bit groups of an IPv6 address, or null when it does not parse. */
function groupsOf(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A dotted tail (::ffff:192.168.1.5) is two more groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const octets = dotted[2].split(".").map(Number);
    if (
      octets.length !== 4 ||
      octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)
    ) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = read(halves[0] ?? "");
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = read(halves[1] ?? "");
  if (!tail || head.length + tail.length > 7) return null;
  return [
    ...head,
    ...new Array(8 - head.length - tail.length).fill(0),
    ...tail,
  ];
}

export function isPrivateAddress(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const kind = isIP(address.split("%")[0] ?? "");
  if (kind === 4) {
    return privateV4(address.split(".").map(Number));
  }
  if (kind !== 6) return false;
  const groups = groupsOf(address);
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;
  // ::1
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return true;
  }
  // ::ffff:a.b.c.d, in either spelling: the IPv4 rules decide.
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff
  ) {
    return privateV4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/** What `os.networkInterfaces()` answers, as far as these checks read it. */
export type InterfaceMap = Readonly<
  Record<
    string,
    | readonly {
        readonly address: string;
        readonly family: string | number;
        readonly internal: boolean;
      }[]
    | undefined
  >
>;

/**
 * This computer's private addresses on its network interfaces, for the
 * certificate and the mDNS answer: private IPv4 and unique-local IPv6, never
 * loopback and never link-local IPv6 (it needs a scope no pet can use).
 */
export function privateInterfaceAddresses(map: InterfaceMap): string[] {
  const found: string[] = [];
  for (const list of Object.values(map)) {
    for (const item of list ?? []) {
      if (item.internal || !isPrivateAddress(item.address)) continue;
      if (item.address.toLowerCase().startsWith("fe80")) continue;
      if (!found.includes(item.address)) found.push(item.address);
    }
  }
  return found;
}
