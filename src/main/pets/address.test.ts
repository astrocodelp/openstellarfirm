import { describe, expect, it } from "vitest";
import { isPrivateAddress, privateInterfaceAddresses } from "./address";

describe("isPrivateAddress", () => {
  it("accepts loopback and the private ranges", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.20",
      "169.254.10.10",
      "::1",
      "fc00::1",
      "fd12:3456::9",
      "fe80::1",
      "fe80::1%en0",
      "febf::1",
    ]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });

  it("refuses a public address and what is not an address", () => {
    for (const a of [
      "8.8.8.8",
      "172.32.0.1",
      "172.15.0.1",
      "192.169.0.1",
      "100.64.0.1",
      "0.0.0.0",
      "2001:4860:4860::8888",
      "fec0::1",
      "ff02::fb",
      "",
      "localhost",
      "not an address",
    ]) {
      expect(isPrivateAddress(a), a).toBe(false);
    }
    expect(isPrivateAddress(undefined)).toBe(false);
    expect(isPrivateAddress(42)).toBe(false);
  });

  it("reads an IPv4-mapped IPv6 address by its IPv4 rules, in both spellings", () => {
    expect(isPrivateAddress("::ffff:192.168.1.5")).toBe(true);
    expect(isPrivateAddress("::ffff:c0a8:105")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
    expect(isPrivateAddress("::ffff:172.32.0.1")).toBe(false);
  });
});

describe("privateInterfaceAddresses", () => {
  it("keeps private addresses and leaves out loopback, link-local IPv6 and public ones", () => {
    expect(
      privateInterfaceAddresses({
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
        en0: [
          { address: "192.168.1.20", family: "IPv4", internal: false },
          { address: "fe80::1", family: "IPv6", internal: false },
          { address: "fd00::20", family: "IPv6", internal: false },
          { address: "203.0.113.9", family: "IPv4", internal: false },
        ],
        none: undefined,
      }),
    ).toEqual(["192.168.1.20", "fd00::20"]);
  });
});
