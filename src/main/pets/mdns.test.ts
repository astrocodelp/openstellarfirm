import type { Socket } from "node:dgram";
import { describe, expect, it } from "vitest";
import {
  buildResponse,
  MDNS_GROUP_V4,
  MDNS_PORT,
  MdnsResponder,
  parseQuery,
} from "./mdns";
import { FakeSocket } from "./rig.testkit";

function nameBytes(name: string): Buffer {
  return Buffer.concat([
    ...name
      .split(".")
      .flatMap((l) => [Buffer.from([l.length]), Buffer.from(l)]),
    Buffer.from([0]),
  ]);
}

/** A query packet, built by hand the way a resolver writes one. */
function query(
  name: string,
  type: number,
  options: { id?: number; unicast?: boolean; flags?: number } = {},
): Buffer {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(options.id ?? 0, 0);
  head.writeUInt16BE(options.flags ?? 0, 2);
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1 | (options.unicast ? 0x8000 : 0), 2);
  return Buffer.concat([head, nameBytes(name), tail]);
}

const responder = () =>
  new MdnsResponder({
    label: "1a2b3c4d",
    addresses: () => ["192.168.1.20", "fd00::20"],
  });

describe("the mDNS reader", () => {
  it("parses a real query packet", () => {
    const parsed = parseQuery(
      query("osf-1a2b3c4d.local", 1, { id: 7, unicast: true }),
    );
    expect(parsed).toEqual({
      id: 7,
      questions: [
        { name: "osf-1a2b3c4d.local", type: 1, cls: 1, unicast: true },
      ],
    });
  });

  it("follows a compression pointer and refuses a loop", () => {
    const head = Buffer.alloc(12);
    head.writeUInt16BE(2, 4);
    const first = nameBytes("a.local");
    // The second question's name is a pointer to the first one's, at offset 12.
    const pointer = Buffer.from([0xc0, 12]);
    const typeClass = Buffer.from([0, 1, 0, 1]);
    const packet = Buffer.concat([head, first, typeClass, pointer, typeClass]);
    expect(parseQuery(packet)?.questions.map((q) => q.name)).toEqual([
      "a.local",
      "a.local",
    ]);
    const loop = Buffer.concat([head, Buffer.from([0xc0, 12]), typeClass]);
    loop.writeUInt16BE(1, 4);
    expect(parseQuery(loop)).toBeNull();
  });

  it("ignores responses, other opcodes and short or broken packets", () => {
    expect(parseQuery(query("a.local", 1, { flags: 0x8400 }))).toBeNull();
    expect(parseQuery(query("a.local", 1, { flags: 0x2800 }))).toBeNull();
    expect(parseQuery(Buffer.alloc(5))).toBeNull();
    expect(parseQuery(query("a.local", 1).subarray(0, 18))).toBeNull();
  });
});

describe("the mDNS answer", () => {
  it("answers an A question with the private IPv4 addresses, TTL 120", () => {
    const answer = responder().answer(query("osf-1a2b3c4d.local", 1));
    expect(answer).not.toBeNull();
    const packet = answer as Buffer;
    expect(packet.readUInt16BE(0)).toBe(0);
    expect(packet.readUInt16BE(2)).toBe(0x8400);
    expect(packet.readUInt16BE(6)).toBe(1);
    const name = nameBytes("osf-1a2b3c4d.local");
    const at = 12 + name.length;
    expect(packet.readUInt16BE(at)).toBe(1); // A
    expect(packet.readUInt16BE(at + 2)).toBe(0x8001); // IN with cache flush
    expect(packet.readUInt32BE(at + 4)).toBe(120);
    expect(packet.readUInt16BE(at + 8)).toBe(4);
    expect([...packet.subarray(at + 10, at + 14)]).toEqual([192, 168, 1, 20]);
  });

  it("answers AAAA with the IPv6 address and ANY with both", () => {
    const aaaa = responder().answer(query("OSF-1A2B3C4D.local", 28)) as Buffer;
    expect(aaaa.readUInt16BE(6)).toBe(1);
    const at = 12 + nameBytes("osf-1a2b3c4d.local").length;
    expect(aaaa.readUInt16BE(at)).toBe(28);
    expect(aaaa.readUInt16BE(at + 8)).toBe(16);
    expect(aaaa[at + 10]).toBe(0xfd);
    expect(aaaa[at + 25]).toBe(0x20);
    const any = responder().answer(query("osf-1a2b3c4d.local", 255)) as Buffer;
    expect(any.readUInt16BE(6)).toBe(2);
  });

  it("stays quiet for any other name, type or class", () => {
    const r = responder();
    expect(r.answer(query("osf-ffffffff.local", 1))).toBeNull();
    expect(r.answer(query("printer.local", 1))).toBeNull();
    expect(r.answer(query("osf-1a2b3c4d.local", 12))).toBeNull(); // PTR
    expect(r.answer(query("osf-1a2b3c4d.local", 33))).toBeNull(); // SRV
    expect(r.answer(query("_services._dns-sd._udp.local", 12))).toBeNull();
    expect(r.answer(query("osf-1a2b3c4d.local.evil", 1))).toBeNull();
  });

  it("builds nothing when there is no address of the asked kind", () => {
    expect(buildResponse("x.local", true, false, ["fd00::1"])).toBeNull();
    expect(buildResponse("x.local", true, true, [])).toBeNull();
  });
});

describe("the mDNS sockets", () => {
  function started() {
    const sockets: FakeSocket[] = [];
    const r = new MdnsResponder({
      label: "1a2b3c4d",
      addresses: () => ["192.168.1.20"],
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s as unknown as Socket;
      },
    });
    return { r, sockets };
  }

  it("advertises nothing on start and joins the groups", async () => {
    const { r, sockets } = started();
    await r.start();
    expect(r.listening).toBe(true);
    expect(sockets).toHaveLength(2);
    expect(sockets.every((s) => s.sent.length === 0)).toBe(true);
    expect(sockets[0]?.memberships).toEqual([MDNS_GROUP_V4]);
    r.stop();
    expect(sockets.every((s) => s.closed)).toBe(true);
    expect(r.listening).toBe(false);
  });

  it("answers a multicast question on the group and a legacy one directly with its id", async () => {
    const { r, sockets } = started();
    await r.start();
    const socket = sockets[0] as FakeSocket;
    socket.emit("message", query("osf-1a2b3c4d.local", 1), {
      address: "192.168.1.9",
      port: MDNS_PORT,
    });
    expect(socket.sent[0]?.address).toBe(MDNS_GROUP_V4);
    expect(socket.sent[0]?.port).toBe(MDNS_PORT);
    socket.emit("message", query("osf-1a2b3c4d.local", 1, { id: 99 }), {
      address: "192.168.1.9",
      port: 40000,
    });
    expect(socket.sent[1]?.address).toBe("192.168.1.9");
    expect(socket.sent[1]?.port).toBe(40000);
    expect(socket.sent[1]?.data.readUInt16BE(0)).toBe(99);
    socket.emit("message", query("other.local", 1), {
      address: "192.168.1.9",
      port: MDNS_PORT,
    });
    expect(socket.sent).toHaveLength(2);
    r.stop();
  });

  it("works without IPv6", async () => {
    const sockets: FakeSocket[] = [];
    const r = new MdnsResponder({
      label: "1a2b3c4d",
      addresses: () => [],
      createSocket: (type) => {
        const s = new FakeSocket();
        if (type === "udp6") {
          s.addMembership = () => {
            throw new Error("no IPv6 multicast");
          };
        }
        sockets.push(s);
        return s as unknown as Socket;
      },
    });
    await r.start();
    expect(r.listening).toBe(true);
    expect(sockets[1]?.closed).toBe(true);
    r.stop();
  });
});
