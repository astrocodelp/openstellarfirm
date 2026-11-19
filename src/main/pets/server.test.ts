import { readFileSync, statSync } from "node:fs";
import { createServer as createTcp } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PET_LIMITS } from "../../shared/pets/limits";
import {
  parseClaimResponse,
  parseHeartbeatResponse,
  parsePairResponse,
  parsePetErrorBody,
} from "../../shared/pets/protocol";
import {
  call,
  heartbeatBody,
  jsonHeaders,
  makeRig,
  newPetSecret,
  pairBody,
  type Rig,
} from "./rig.testkit";
import { PET_ROUTES } from "./server";

let rig: Rig;
afterEach(async () => {
  await rig?.cleanup();
});

async function started(extra: Parameters<typeof makeRig>[0] = {}) {
  rig = makeRig(extra);
  const status = await rig.service.turnOn();
  const port = status.port as number;
  const fingerprint = status.fingerprint as string;
  const get = (
    method: string,
    path: string,
    options?: Parameters<typeof call>[4],
  ) => call(port, fingerprint, method, path, options);
  return { status, port, fingerprint, get };
}

/** Pairs a pet all the way and returns its token. */
async function pairedPet(get: Awaited<ReturnType<typeof started>>["get"]) {
  const { code } = await rig.service.startAdding();
  const pet = newPetSecret();
  const paired = await get("POST", "/api/pets/pair", {
    headers: jsonHeaders,
    body: pairBody(code, pet.deviceKey),
  });
  const pairing = parsePairResponse(paired.json);
  if (!pairing.ok) throw new Error(pairing.error);
  expect((await rig.service.confirm(pairing.value.confirmCode)).result).toBe(
    "confirmed",
  );
  const claimed = await get("POST", "/api/pets/pair/claim", {
    headers: jsonHeaders,
    body: JSON.stringify({
      requestId: pairing.value.requestId,
      deviceSecret: pet.secret,
    }),
  });
  const parsed = parseClaimResponse(claimed.json);
  if (!parsed.ok) throw new Error(parsed.error);
  return {
    token: parsed.value.token,
    claim: parsed.value,
    pairing: pairing.value,
    pet,
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("pairing over TLS", () => {
  it("pairs a pet: setup code, confirm code typed, claim once", async () => {
    const { get } = await started();
    const { code } = await rig.service.startAdding();
    const pet = newPetSecret();
    const paired = await get("POST", "/api/pets/pair", {
      headers: jsonHeaders,
      body: pairBody(code, pet.deviceKey, "cat"),
    });
    expect(paired.status).toBe(200);
    const pairing = parsePairResponse(paired.json);
    expect(pairing.ok).toBe(true);
    if (!pairing.ok) return;
    const claimBody = JSON.stringify({
      requestId: pairing.value.requestId,
      deviceSecret: pet.secret,
    });

    // Not approved yet: the pet keeps waiting.
    const waiting = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: claimBody,
    });
    expect(waiting.status).toBe(202);
    expect(waiting.json).toEqual({ status: "waiting" });

    const status = await rig.service.status();
    expect(status.pending?.kind).toBe("cat");
    expect(status.pending?.triesLeft).toBe(5);

    // A wrong code does nothing but count.
    const wrong =
      pairing.value.confirmCode === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA";
    expect(await rig.service.confirm(wrong)).toEqual({
      result: "wrong",
      triesLeft: 4,
    });
    expect(
      (
        await get("POST", "/api/pets/pair/claim", {
          headers: jsonHeaders,
          body: claimBody,
        })
      ).status,
    ).toBe(202);

    // The typed code, in any case and spacing, approves.
    const typed = pairing.value.confirmCode.toLowerCase().replace("-", " ");
    expect(await rig.service.confirm(typed)).toEqual({ result: "confirmed" });

    const claimed = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: claimBody,
    });
    expect(claimed.status).toBe(200);
    const parsed = parseClaimResponse(claimed.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.pet.kind).toBe("cat");
    expect(parsed.value.pet.name).toBe("Comet");

    // The token comes exactly once.
    const again = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: claimBody,
    });
    expect(again.status).toBe(410);
    expect(parsePetErrorBody(again.json)).toMatchObject({
      ok: true,
      value: { error: "gone" },
    });

    expect((await rig.service.status()).pets).toHaveLength(1);
  });

  it("refuses a wrong, spent or expired setup code and a malformed request", async () => {
    const { get } = await started();
    const { code } = await rig.service.startAdding();
    const pet = newPetSecret();
    const post = (body: string) =>
      get("POST", "/api/pets/pair", { headers: jsonHeaders, body });
    const wrong = await post(pairBody("ABCDE-FGHJK", pet.deviceKey));
    expect(wrong.status).toBe(400);
    expect(wrong.json).toEqual({ error: "bad_code", line: "setup-refused" });
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ setupCode: code }))).json).toEqual({
      error: "bad_request",
      line: "busy",
    });
    expect((await post(pairBody(code, pet.deviceKey))).status).toBe(200);
    // A setup code is spent by its first good request.
    expect((await post(pairBody(code, pet.deviceKey))).status).toBe(400);

    const second = await rig.service.startAdding();
    rig.clock.ms += (PET_LIMITS.setupCodeTtlSeconds + 1) * 1000;
    expect((await post(pairBody(second.code, pet.deviceKey))).status).toBe(400);
  });

  it("closes the request after five wrong confirm codes and the claim is gone", async () => {
    const { get } = await started();
    const { code } = await rig.service.startAdding();
    const pet = newPetSecret();
    const paired = parsePairResponse(
      (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody(code, pet.deviceKey),
        })
      ).json,
    );
    if (!paired.ok) throw new Error(paired.error);
    const wrong =
      paired.value.confirmCode === "AAAA-AAAA" ? "BBBB-BBBB" : "AAAA-AAAA";
    for (let left = 4; left >= 1; left -= 1) {
      expect(await rig.service.confirm(wrong)).toEqual({
        result: "wrong",
        triesLeft: left,
      });
    }
    expect(await rig.service.confirm(wrong)).toEqual({ result: "closed" });
    // Even the right code is no use now.
    expect(await rig.service.confirm(paired.value.confirmCode)).toEqual({
      result: "none",
    });
    const claim = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: JSON.stringify({
        requestId: paired.value.requestId,
        deviceSecret: pet.secret,
      }),
    });
    expect(claim.status).toBe(410);
    expect((await rig.service.status()).pets).toHaveLength(0);
  });

  it("does not count a malformed confirm code and refuses a claim with another secret", async () => {
    const { get } = await started();
    const { code } = await rig.service.startAdding();
    const pet = newPetSecret();
    const paired = parsePairResponse(
      (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody(code, pet.deviceKey),
        })
      ).json,
    );
    if (!paired.ok) throw new Error(paired.error);
    expect(await rig.service.confirm("123")).toEqual({ result: "invalid" });
    expect((await rig.service.status()).pending?.triesLeft).toBe(5);
    await rig.service.confirm(paired.value.confirmCode);
    const other = newPetSecret();
    const stolen = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: JSON.stringify({
        requestId: paired.value.requestId,
        deviceSecret: other.secret,
      }),
    });
    expect(stolen.status).toBe(410);
    // The real pet can still claim: a stranger's try closed nothing.
    const real = await get("POST", "/api/pets/pair/claim", {
      headers: jsonHeaders,
      body: JSON.stringify({
        requestId: paired.value.requestId,
        deviceSecret: pet.secret,
      }),
    });
    expect(real.status).toBe(200);
  });

  it("asks for a new setup code to replace the old one and its open request", async () => {
    const { get } = await started();
    const first = await rig.service.startAdding();
    const pet = newPetSecret();
    const paired = parsePairResponse(
      (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody(first.code, pet.deviceKey),
        })
      ).json,
    );
    if (!paired.ok) throw new Error(paired.error);
    await rig.service.startAdding();
    expect((await rig.service.status()).pending).toBeNull();
    expect(await rig.service.confirm(paired.value.confirmCode)).toEqual({
      result: "none",
    });
  });

  it("limits pairing requests for one address", async () => {
    const { get } = await started();
    const pet = newPetSecret();
    let last = 0;
    for (let i = 0; i <= PET_LIMITS.pairPerMinute; i += 1) {
      last = (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody("ABCDE-FGHJK", pet.deviceKey),
        })
      ).status;
    }
    expect(last).toBe(429);
    rig.clock.ms += 61_000;
    expect(
      (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody("ABCDE-FGHJK", pet.deviceKey),
        })
      ).status,
    ).toBe(400);
  });

  it("answers 413 to a body over its cap", async () => {
    const { get } = await started();
    const huge = await get("POST", "/api/pets/pair", {
      headers: jsonHeaders,
      body: "x".repeat(9000),
    });
    expect(huge.status).toBe(413);
    expect(huge.json).toEqual({ error: "too_long", line: "didnt-catch" });
  });
});

describe("the heartbeat and the token", () => {
  it("keeps a paired pet seen and answers its settings", async () => {
    const { get } = await started();
    const { token } = await pairedPet(get);
    const beat = await get("POST", "/api/pets/heartbeat", {
      headers: { ...jsonHeaders, ...bearer(token) },
      body: heartbeatBody,
    });
    expect(beat.status).toBe(200);
    const parsed = parseHeartbeatResponse(beat.json);
    expect(parsed.ok && parsed.value.quiet).toBe(false);
    const [pet] = (await rig.service.status()).pets;
    expect(pet?.online).toBe(true);
    expect(pet?.battery).toBe(0.8);
    expect(pet?.firmware).toBe("0.1.0");
    rig.clock.ms += (PET_LIMITS.onlineWindowSeconds + 1) * 1000;
    expect((await rig.service.status()).pets[0]?.online).toBe(false);
  });

  it("answers 401 forgotten to a missing, malformed or wrong token", async () => {
    const { get } = await started();
    await pairedPet(get);
    const wrongHeaders: Record<string, string>[] = [
      {},
      { Authorization: "Bearer short" },
      { Authorization: `Bearer ${"A".repeat(43)}` },
      { Authorization: `Basic ${"A".repeat(43)}` },
    ];
    for (const headers of wrongHeaders) {
      const answer = await get("POST", "/api/pets/heartbeat", {
        headers: { ...jsonHeaders, ...headers },
        body: heartbeatBody,
      });
      expect(answer.status).toBe(401);
      expect(answer.json).toEqual({ error: "forgotten", line: "disconnected" });
    }
  });

  it("refuses a heartbeat that is not the protocol's", async () => {
    const { get } = await started();
    const { token } = await pairedPet(get);
    const answer = await get("POST", "/api/pets/heartbeat", {
      headers: { ...jsonHeaders, ...bearer(token) },
      body: JSON.stringify({ battery: 7 }),
    });
    expect(answer.status).toBe(400);
  });

  it("forgets a pet at once: its token stops working", async () => {
    const { get } = await started();
    const { token, claim } = await pairedPet(get);
    const beat = () =>
      get("POST", "/api/pets/heartbeat", {
        headers: { ...jsonHeaders, ...bearer(token) },
        body: heartbeatBody,
      });
    expect((await beat()).status).toBe(200);
    await rig.service.forget(claim.deviceId);
    expect((await beat()).status).toBe(401);
    expect((await rig.service.status()).pets).toHaveLength(0);
  });

  it("renames a pet by the protocol's rules", async () => {
    const { get } = await started();
    const { claim } = await pairedPet(get);
    const renamed = await rig.service.rename(claim.deviceId, "  Star Dust ");
    expect(renamed.pets[0]?.name).toBe("Star Dust");
    await expect(rig.service.rename(claim.deviceId, "R2D2")).rejects.toThrow(
      /letters/,
    );
    await expect(rig.service.rename("nope", "Nova")).rejects.toThrow(
      /not paired/,
    );
  });
});

describe("the routes P3 fills in", () => {
  it("authenticate the token and answer a stable not-ready error", async () => {
    const { get } = await started();
    const { token } = await pairedPet(get);
    const auth = bearer(token);
    const turn = await get("POST", "/api/pets/turn", {
      headers: { ...auth, "Content-Type": "audio/wav", "X-Pet-Turn": "x" },
      body: Buffer.alloc(2000),
    });
    expect(turn.status).toBe(503);
    expect(turn.json).toEqual({ error: "voice_off", line: "busy" });
    const say = await get("GET", "/api/pets/say/12", { headers: auth });
    expect([say.status, say.json]).toEqual([
      503,
      { error: "voice_off", line: "busy" },
    ]);
    const inbox = await get("GET", "/api/pets/inbox?after=0&wait=0", {
      headers: auth,
    });
    expect([inbox.status, inbox.json]).toEqual([
      503,
      { error: "store_off", line: "busy" },
    ]);

    for (const [method, path] of [
      ["POST", "/api/pets/turn"],
      ["GET", "/api/pets/say/1"],
      ["GET", "/api/pets/inbox"],
    ] as const) {
      expect((await get(method, path)).status, path).toBe(401);
    }
  });

  it("refuses an upload over the cap before reading it", async () => {
    const { get } = await started();
    const { token } = await pairedPet(get);
    const big = await get("POST", "/api/pets/turn", {
      headers: { ...bearer(token), "Content-Type": "audio/wav" },
      body: Buffer.alloc(PET_LIMITS.uploadMaxBytes + 1),
    });
    expect(big.status).toBe(413);
  });

  it("serves a voice pack path with no token, only for a known voice", async () => {
    const { get } = await started();
    expect((await get("GET", "/pets/voice/talia.sfvp")).status).toBe(503);
    expect((await get("GET", "/pets/voice/nobody.sfvp")).status).toBe(404);
  });
});

describe("what every answer looks like", () => {
  it("carries no-store, nosniff and JSON, and no cross-site or redirect header", async () => {
    const { get } = await started();
    const { token } = await pairedPet(get);
    const answers = [
      await get("GET", "/nothing"),
      await get("POST", "/api/pets/pair", { headers: jsonHeaders, body: "{}" }),
      await get("POST", "/api/pets/heartbeat", {
        headers: { ...jsonHeaders, ...bearer(token) },
        body: heartbeatBody,
      }),
      await get("GET", "/api/pets/inbox", { headers: bearer(token) }),
      await get("OPTIONS", "/api/pets/pair", {
        headers: { Origin: "https://evil.example" },
      }),
    ];
    for (const a of answers) {
      expect(a.headers["cache-control"]).toBe("no-store");
      expect(a.headers["x-content-type-options"]).toBe("nosniff");
      expect(a.headers["content-type"]).toBe("application/json");
      expect(a.status >= 300 && a.status < 400, "no redirect").toBe(false);
      for (const name of Object.keys(a.headers)) {
        expect(name).not.toMatch(/^access-control-/);
      }
      expect(a.headers.location).toBeUndefined();
    }
  });

  it("answers 404 to an unknown path and to a known path with another method", async () => {
    const { get } = await started();
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/api/pets"],
      ["GET", "/api/pets/pair"],
      ["POST", "/api/pets/inbox"],
      ["DELETE", "/api/pets/pair"],
      ["OPTIONS", "/api/pets/pair"],
      ["GET", "/api/pets/say/abc"],
      ["GET", "/api/pets/../pair"],
      ["POST", "/api/pets/approve"],
    ] as const) {
      const a = await get(method, path);
      expect(a.status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("who may connect", () => {
  it("drops an address that is not private before any TLS is read", async () => {
    const seen: (string | undefined)[] = [];
    rig = makeRig({
      allowAddress: (address) => {
        seen.push(address);
        return false;
      },
    });
    const status = await rig.service.turnOn();
    await expect(
      call(
        status.port as number,
        status.fingerprint as string,
        "GET",
        "/nothing",
      ),
    ).rejects.toThrow();
    expect(seen[0]).toMatch(/127\.0\.0\.1/);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("lets a loopback or private address in by default", async () => {
    const { get } = await started();
    expect((await get("GET", "/nothing")).status).toBe(404);
  });
});

describe("what is kept", () => {
  it("holds only digests of codes and tokens, in a file only the owner reads", async () => {
    const { get } = await started();
    const setup = await rig.service.startAdding();
    const pet = newPetSecret();
    const paired = parsePairResponse(
      (
        await get("POST", "/api/pets/pair", {
          headers: jsonHeaders,
          body: pairBody(setup.code, pet.deviceKey),
        })
      ).json,
    );
    if (!paired.ok) throw new Error(paired.error);
    const midway = readFileSync(rig.file, "utf8");
    expect(midway).not.toContain(setup.code);
    expect(midway).not.toContain(setup.code.replace("-", ""));
    expect(midway).not.toContain(paired.value.confirmCode);
    expect(midway).not.toContain(paired.value.confirmCode.replace("-", ""));
    await rig.service.confirm(paired.value.confirmCode);
    const claim = parseClaimResponse(
      (
        await get("POST", "/api/pets/pair/claim", {
          headers: jsonHeaders,
          body: JSON.stringify({
            requestId: paired.value.requestId,
            deviceSecret: pet.secret,
          }),
        })
      ).json,
    );
    if (!claim.ok) throw new Error(claim.error);
    const after = readFileSync(rig.file, "utf8");
    expect(after).not.toContain(claim.value.token);
    expect(after).not.toContain(pet.secret);
    expect(JSON.parse(after).pets[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    if (process.platform !== "win32") {
      expect(statSync(rig.file).mode & 0o777).toBe(0o600);
    }
    // The key and the certificate are in the keychain-sealed store, not the file.
    expect(after).not.toContain("PRIVATE KEY");
    expect(after).not.toContain("BEGIN CERTIFICATE");
  });
});

describe("the routes", () => {
  it("are exactly these, and every one is a pet's own", () => {
    expect(PET_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/pets/pair",
      "POST /api/pets/pair/claim",
      "POST /api/pets/heartbeat",
      "POST /api/pets/turn",
      "GET /api/pets/say/:n",
      "GET /api/pets/inbox",
      "GET /pets/voice/:voice.sfvp",
    ]);
  });
});

describe("a busy port", () => {
  it("falls back to a port the system picks and keeps it", async () => {
    const busy = createTcp();
    await new Promise<void>((r) => busy.listen(0, "127.0.0.1", r));
    const taken = (busy.address() as { port: number }).port;
    try {
      rig = makeRig({ defaultPort: taken });
      const status = await rig.service.turnOn();
      expect(status.running).toBe(true);
      expect(status.port).not.toBe(taken);
      expect(JSON.parse(readFileSync(rig.file, "utf8")).port).toBe(status.port);
    } finally {
      busy.close();
    }
  });
});
