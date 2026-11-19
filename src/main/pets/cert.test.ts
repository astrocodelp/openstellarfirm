import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { connect, createServer } from "node:tls";
import { describe, expect, it } from "vitest";
import {
  fingerprintOfPem,
  makeCertificate,
  publicKeyOfPrivatePem,
} from "./cert";

const input = {
  now: new Date("2026-11-19T12:00:00Z"),
  randomBytes: (n: number) => randomBytes(n),
  dnsName: "osf-1a2b3c4d.local",
  ips: ["192.168.1.20", "fd00::20", "not an ip"],
};

describe("the desk pet certificate", () => {
  const made = makeCertificate(input);

  it("round-trips through X509Certificate and verifies against its own key", () => {
    const x509 = new X509Certificate(made.certPem);
    expect(x509.verify(publicKeyOfPrivatePem(made.keyPem))).toBe(true);
    expect(x509.subject).toBe("CN=OpenStellarFirm desk pets");
    expect(x509.issuer).toBe("CN=OpenStellarFirm desk pets");
    expect(x509.ca).toBe(false);
  });

  it("is valid for ten years from now and not before an hour ago", () => {
    const x509 = new X509Certificate(made.certPem);
    expect(Date.parse(x509.validFrom)).toBe(Date.parse("2026-11-19T11:00:00Z"));
    expect(Date.parse(x509.validTo)).toBe(Date.parse("2036-11-19T12:00:00Z"));
  });

  it("names the mDNS name and the private addresses, and serves TLS", () => {
    const x509 = new X509Certificate(made.certPem);
    expect(x509.subjectAltName).toContain("DNS:osf-1a2b3c4d.local");
    expect(x509.subjectAltName).toContain("IP Address:192.168.1.20");
    expect(x509.subjectAltName?.toLowerCase()).toContain("fd00:0:0:0:0:0:0:20");
    expect(x509.checkHost("osf-1a2b3c4d.local")).toBeTruthy();
    expect(x509.checkIP("192.168.1.20")).toBeTruthy();
  });

  it("has server-auth extended key usage", () => {
    const x509 = new X509Certificate(made.certPem);
    expect(x509.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  it("has a 16-byte positive serial that differs between certificates", () => {
    const a = new X509Certificate(made.certPem);
    const b = new X509Certificate(makeCertificate(input).certPem);
    expect(a.serialNumber).toHaveLength(32);
    expect(a.serialNumber).not.toBe(b.serialNumber);
    expect(Number.parseInt(a.serialNumber.slice(0, 2), 16)).toBeLessThan(0x80);
  });

  it("gives the SHA-256 of the DER as 64 lowercase hex characters", () => {
    expect(made.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const der = new X509Certificate(made.certPem).raw;
    expect(made.fingerprint).toBe(
      createHash("sha256").update(der).digest("hex"),
    );
    expect(fingerprintOfPem(made.certPem)).toBe(made.fingerprint);
  });

  it("is accepted by a TLS server and offered to a client", async () => {
    const server = createServer({ key: made.keyPem, cert: made.certPem }, (s) =>
      s.end("ok"),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const seen = await new Promise<string>((resolve, reject) => {
      const socket = connect(
        { host: "127.0.0.1", port, rejectUnauthorized: false },
        () => {
          const raw = socket.getPeerCertificate().raw;
          socket.end();
          resolve(createHash("sha256").update(raw).digest("hex"));
        },
      );
      socket.on("error", reject);
    });
    server.close();
    expect(seen).toBe(made.fingerprint);
  });

  it("writes GeneralizedTime from 2050 on", () => {
    const late = makeCertificate({
      ...input,
      now: new Date("2045-06-01T00:00:00Z"),
    });
    const x509 = new X509Certificate(late.certPem);
    expect(Date.parse(x509.validTo)).toBe(Date.parse("2055-06-01T00:00:00Z"));
  });
});
