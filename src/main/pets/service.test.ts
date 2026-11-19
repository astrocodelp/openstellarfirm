import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { call, makeRig, type Rig } from "./rig.testkit";
import {
  CERT_SECRET,
  KEY_SECRET,
  NO_KEYCHAIN_MESSAGE,
  PetService,
} from "./service";

let rig: Rig;
afterEach(async () => {
  await rig?.cleanup();
});

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

describe("Desk pets are off by default", () => {
  it("opens no port and no multicast socket until turned on", async () => {
    rig = makeRig();
    const status = await rig.service.status();
    expect(status).toMatchObject({
      enabled: false,
      running: false,
      port: null,
      mdnsRunning: false,
      fingerprint: null,
      pets: [],
      pending: null,
    });
    expect(status.mdnsName).toMatch(/^osf-[0-9a-f]{8}\.local$/);
    expect(rig.sockets).toHaveLength(0);
    expect(rig.secrets.values.size).toBe(0);
  });

  it("keeps the same mDNS name across restarts", async () => {
    rig = makeRig();
    const name = (await rig.service.status()).mdnsName;
    const again = new PetService({ file: rig.file, secrets: rig.secrets });
    expect((await again.status()).mdnsName).toBe(name);
  });

  it("reports whether the file says on, without building anything", async () => {
    rig = makeRig();
    expect(PetService.savedOn(rig.file)).toBe(false);
    await rig.service.turnOn();
    expect(PetService.savedOn(rig.file)).toBe(true);
    await rig.service.turnOff();
    expect(PetService.savedOn(rig.file)).toBe(false);
    expect(PetService.savedOn("/nonexistent/file.json")).toBe(false);
  });
});

describe("turning on and off", () => {
  it("fails with a plain reason when the keychain is not usable, and opens nothing", async () => {
    rig = makeRig();
    rig.secrets.usable = false;
    await expect(rig.service.turnOn()).rejects.toThrow(NO_KEYCHAIN_MESSAGE);
    const status = await rig.service.status();
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(rig.sockets).toHaveLength(0);
    expect(rig.secrets.values.size).toBe(0);
    await expect(rig.service.newCertificate()).rejects.toThrow(
      NO_KEYCHAIN_MESSAGE,
    );
  });

  it("makes the certificate once, keeps it in the keychain only and listens", async () => {
    rig = makeRig();
    const on = await rig.service.turnOn();
    expect(on).toMatchObject({
      enabled: true,
      running: true,
      mdnsRunning: true,
    });
    expect(on.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rig.secrets.values.has(KEY_SECRET)).toBe(true);
    expect(rig.secrets.values.has(CERT_SECRET)).toBe(true);
    expect(readFileSync(rig.file, "utf8")).not.toContain("PRIVATE KEY");
    expect(rig.sockets.length).toBeGreaterThan(0);
    expect((await rig.service.turnOn()).fingerprint).toBe(on.fingerprint);
    expect(
      (await call(on.port as number, on.fingerprint as string, "GET", "/x"))
        .status,
    ).toBe(404);
  });

  it("turning off closes the port and the name answer and keeps the pets and certificate", async () => {
    rig = makeRig();
    const on = await rig.service.turnOn();
    const port = on.port as number;
    expect(await canConnect(port)).toBe(true);
    const off = await rig.service.turnOff();
    expect(off).toMatchObject({
      enabled: false,
      running: false,
      mdnsRunning: false,
    });
    expect(await canConnect(port)).toBe(false);
    expect(rig.sockets.every((s) => s.closed)).toBe(true);
    expect(off.fingerprint).toBe(on.fingerprint);
  });

  it("resumes at launch only when it was left on", async () => {
    rig = makeRig();
    const on = await rig.service.turnOn();
    await rig.service.shutdown();
    const next = new PetService({
      file: rig.file,
      secrets: rig.secrets,
      host: "127.0.0.1",
      createSocket: () => rig.sockets[0] as never,
      interfaces: () => ({}),
    });
    await next.resume();
    const status = await next.status();
    expect(status.running).toBe(true);
    expect(status.fingerprint).toBe(on.fingerprint);
    await next.shutdown();

    await rig.service.turnOff();
    const quiet = new PetService({ file: rig.file, secrets: rig.secrets });
    await quiet.resume();
    expect((await quiet.status()).running).toBe(false);
  });

  it("says why when it cannot resume", async () => {
    rig = makeRig();
    await rig.service.turnOn();
    await rig.service.shutdown();
    rig.secrets.values.clear();
    const next = new PetService({ file: rig.file, secrets: rig.secrets });
    await next.resume();
    const status = await next.status();
    expect(status.running).toBe(false);
    expect(status.enabled).toBe(true);
    expect(status.problem).toMatch(/certificate is missing/);
  });

  it("starts without the name answer when multicast is refused, and says so", async () => {
    rig = makeRig({
      createSocket: () => {
        throw new Error("no multicast");
      },
    });
    const status = await rig.service.turnOn();
    expect(status.running).toBe(true);
    expect(status.mdnsRunning).toBe(false);
    expect(status.problem).toMatch(/network name/);
  });
});

describe("a new certificate", () => {
  it("replaces the certificate, forgets every pet and the pending pairing", async () => {
    rig = makeRig();
    const on = await rig.service.turnOn();
    await rig.service.startAdding();
    // A pet written straight into the file stands in for a paired one.
    const before = JSON.parse(readFileSync(rig.file, "utf8"));
    expect(before.setup).toHaveLength(1);

    const next = await rig.service.newCertificate();
    expect(next.fingerprint).not.toBe(on.fingerprint);
    expect(next).toMatchObject({
      enabled: true,
      running: true,
      pets: [],
      setupExpiresAt: null,
    });
    const after = JSON.parse(readFileSync(rig.file, "utf8"));
    expect(after).toMatchObject({ pets: [], setup: [], requests: [] });
    // The old pin no longer matches what the server shows.
    await expect(
      call(next.port as number, on.fingerprint as string, "GET", "/x"),
    ).rejects.toThrow(/pinned/);
    expect(
      (await call(next.port as number, next.fingerprint as string, "GET", "/x"))
        .status,
    ).toBe(404);
  });

  it("leaves a switched-off app off", async () => {
    rig = makeRig();
    const made = await rig.service.newCertificate();
    expect(made.running).toBe(false);
    expect(made.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the saved file", () => {
  it("is treated as empty when it does not read, and desk pets stay off", async () => {
    rig = makeRig();
    writeFileSync(rig.file, "{ not json");
    const again = new PetService({ file: rig.file, secrets: rig.secrets });
    const status = await again.status();
    expect(status.enabled).toBe(false);
    expect(status.pets).toEqual([]);
    expect(existsSync(rig.file)).toBe(true);
  });

  it("drops a pet record that is not the protocol's", async () => {
    rig = makeRig();
    await rig.service.status();
    const saved = JSON.parse(readFileSync(rig.file, "utf8"));
    saved.pets = [
      { id: "x", name: "R2", kind: "astronaut", tokenHash: "nope" },
    ];
    writeFileSync(rig.file, JSON.stringify(saved));
    const again = new PetService({ file: rig.file, secrets: rig.secrets });
    expect((await again.status()).pets).toEqual([]);
  });

  it("makes the setup code only when running", async () => {
    rig = makeRig();
    await expect(rig.service.startAdding()).rejects.toThrow(
      /Turn Desk pets on/,
    );
    await rig.service.turnOn();
    const made = await rig.service.startAdding();
    expect(made.code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect((await rig.service.status()).setupExpiresAt).toBe(made.expiresAt);
  });
});
