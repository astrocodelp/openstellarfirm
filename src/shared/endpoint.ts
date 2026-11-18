const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Checks a model address before it is saved or called.
 *
 * A key must never travel in the clear, so a remote address has to be https.
 * Plain http is allowed only for a model on this computer. An address that
 * carries a sign-in or a query is refused, since both end up in logs.
 */
export function checkEndpoint(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That address is not a web address.");
  }
  if (url.username || url.password) {
    throw new Error(
      "Leave the sign-in out of the address. Put the key in the key field.",
    );
  }
  if (url.search || url.hash) {
    throw new Error("The address cannot have a question mark or a hash in it.");
  }
  const local = LOOPBACK.has(url.hostname);
  if (url.protocol === "http:" && !local) {
    throw new Error(
      "An address on another computer has to start with https://.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The address has to start with https://.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    return LOOPBACK.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
